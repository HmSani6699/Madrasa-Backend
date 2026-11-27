const assert = require("assert");
const { ObjectId } = require("mongodb");
const {
  getMadrasaSmsSettings,
  triggerAttendanceSms,
  getBangladeshDateStr,
  formatBdPhone,
  buildGatewayRequest,
} = require("../services/sms.service");

const createMockDb = ({ madrasa, students, parents, rates }) => {
  const state = {
    madrasas: [madrasa],
    students,
    parents,
    sms_rates: rates ? [rates] : [],
    sms_logs: [],
  };

  const matchFilter = (doc, query = {}) => {
    return Object.entries(query).every(([key, val]) => {
      const docVal = doc[key];
      if (val && typeof val === "object" && !(val instanceof ObjectId)) {
        if (val.$in) {
          return val.$in.some((item) => String(item) === String(docVal));
        }
        if (val.$gte !== undefined) {
          return Number(docVal) >= Number(val.$gte);
        }
      }
      return String(docVal) === String(val);
    });
  };

  return {
    state,
    collection(name) {
      const arr = state[name];
      return {
        async findOne(query = {}) {
          return arr.find((d) => matchFilter(d, query)) || null;
        },
        find(query = {}) {
          const filtered = arr.filter((d) => matchFilter(d, query));
          return {
            project() {
              return this;
            },
            async toArray() {
              return filtered;
            },
          };
        },
        async findOneAndUpdate(query, update) {
          const idx = arr.findIndex((d) => matchFilter(d, query));
          if (idx === -1) return { value: null };
          if (update.$inc) {
            Object.entries(update.$inc).forEach(([k, delta]) => {
              arr[idx][k] = Number(((arr[idx][k] || 0) + delta).toFixed(2));
            });
          }
          return { value: { ...arr[idx] } };
        },
        async updateOne(query, update) {
          const idx = arr.findIndex((d) => matchFilter(d, query));
          if (idx === -1) return { modifiedCount: 0 };
          if (update.$inc) {
            Object.entries(update.$inc).forEach(([k, delta]) => {
              arr[idx][k] = Number(((arr[idx][k] || 0) + delta).toFixed(2));
            });
          }
          return { modifiedCount: 1 };
        },
        async insertMany(docs) {
          arr.push(...docs);
          return { insertedCount: docs.length };
        },
      };
    },
  };
};

const run = async () => {
  const madrasaId = new ObjectId();
  const guardian1Id = new ObjectId();
  const guardian2Id = new ObjectId();
  const student1Id = new ObjectId();
  const student2Id = new ObjectId();
  const todayStr = getBangladeshDateStr(new Date());

  const makeDb = (smsSettings = {}, balance = 10) =>
    createMockDb({
      madrasa: {
        _id: madrasaId,
        name: "Madrasa Noor",
        smsWalletBalance: balance,
        smsSettings,
      },
      students: [
        { _id: student1Id, madrasa_id: madrasaId, firstName: "Tariq", lastName: "Ali", guardian_id: guardian1Id },
        { _id: student2Id, madrasa_id: madrasaId, firstName: "Zayd", lastName: "Hasan", guardian_id: guardian2Id },
      ],
      parents: [
        { _id: guardian1Id, fatherName: "Karim Ali", contact: "01711111111" },
        { _id: guardian2Id, fatherName: "Mahmud Hasan", contact: "01722222222" },
      ],
      rates: { singleSmsRate: 0.30, bulkSmsRate: 0.25, maskingSmsRate: 0.40 },
    });

  // 1. Default settings should have attendance OFF
  const defaultSettings = getMadrasaSmsSettings({});
  assert.strictEqual(defaultSettings.attendance, false);
  assert.strictEqual(defaultSettings.attendanceTrigger, "absent_only");

  // 2. Disabled setting skips SMS
  {
    const db = makeDb({ attendance: false });
    const res = await triggerAttendanceSms(db, {
      madrasaId,
      date: todayStr,
      records: [{ student_id: student1Id.toString(), status: "Absent" }],
    });
    assert.strictEqual(res.triggered, false);
    assert.strictEqual(res.skippedReason, "setting_disabled");
    assert.strictEqual(db.state.sms_logs.length, 0);
  }

  // 3. Enabled + absent_only sends only to Absent student and prevents same-day duplicate
  {
    const db = makeDb({
      attendance: true,
      attendanceTrigger: "absent_only",
      attendanceTemplates: {
        Absent: "{student_name} absent on {date} at {madrasa_name}",
        Late: "{student_name} late",
        Present: "{student_name} present",
      },
    }, 10);

    const first = await triggerAttendanceSms(db, {
      madrasaId,
      date: todayStr,
      records: [
        { student_id: student1Id.toString(), status: "Absent" },
        { student_id: student2Id.toString(), status: "Present" },
      ],
    });
    assert.strictEqual(first.triggered, true);
    assert.strictEqual(first.sentCount, 1);
    assert.strictEqual(db.state.sms_logs.length, 1);
    assert.strictEqual(db.state.sms_logs[0].to, "01711111111");
    assert.strictEqual(db.state.sms_logs[0].message, `Tariq Ali absent on ${todayStr} at Madrasa Noor`);
    assert.strictEqual(db.state.madrasas[0].smsWalletBalance, 9.7);

    // Second save on same day should skip Tariq Ali
    const second = await triggerAttendanceSms(db, {
      madrasaId,
      date: todayStr,
      records: [
        { student_id: student1Id.toString(), status: "Absent" },
        { student_id: student2Id.toString(), status: "Present" },
      ],
    });
    assert.strictEqual(second.triggered, false);
    assert.strictEqual(second.skippedReason, "already_sent_today");
    assert.strictEqual(db.state.sms_logs.length, 1);
  }

  // 4. Historical date edit should NOT trigger SMS
  {
    const db = makeDb({ attendance: true, attendanceTrigger: "all" }, 10);
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const res = await triggerAttendanceSms(db, {
      madrasaId,
      date: yesterday,
      records: [{ student_id: student1Id.toString(), status: "Absent" }],
    });
    assert.strictEqual(res.triggered, false);
    assert.strictEqual(res.skippedReason, "not_today");
  }

  // 5. Insufficient balance skips without throwing or negative balance
  {
    const db = makeDb({ attendance: true, attendanceTrigger: "absent_only" }, 0.10);
    const res = await triggerAttendanceSms(db, {
      madrasaId,
      date: todayStr,
      records: [{ student_id: student1Id.toString(), status: "Absent" }],
    });
    assert.strictEqual(res.skippedReason, "insufficient_balance");
    assert.strictEqual(db.state.madrasas[0].smsWalletBalance, 0.10);
    assert.strictEqual(db.state.sms_logs.length, 0);
  }

  // 6. absent_late sends to both Absent and Late
  {
    const db = makeDb({
      attendance: true,
      attendanceTrigger: "absent_late",
      attendanceTemplates: {
        Absent: "{student_name} absent",
        Late: "{student_name} late",
        Present: "{student_name} present",
      },
    }, 10);
    const res = await triggerAttendanceSms(db, {
      madrasaId,
      date: todayStr,
      records: [
        { student_id: student1Id.toString(), status: "Absent" },
        { student_id: student2Id.toString(), status: "Late" },
      ],
    });
    assert.strictEqual(res.sentCount, 2);
    assert.strictEqual(db.state.sms_logs.length, 2);
  }

  // 7. Gateway phone formatting & provider payload builders
  {
    assert.strictEqual(formatBdPhone("01711-111111"), "8801711111111");
    assert.strictEqual(formatBdPhone("+8801812345678"), "8801812345678");

    const bulkReq = buildGatewayRequest({
      provider: "bulksmsbd",
      apiKey: "k1",
      senderId: "s1",
      to: "01711111111",
      message: "Hello",
    });
    assert.strictEqual(bulkReq.data.number, "8801711111111");
    assert.strictEqual(bulkReq.isSuccess({ response_code: 202 }), true);
    assert.strictEqual(bulkReq.isSuccess({ response_code: 1002 }), false);

    const sslReq = buildGatewayRequest({
      provider: "sslwireless",
      apiKey: "tok",
      senderId: "SID",
      to: "01711111111",
      message: "Hello",
    });
    assert.strictEqual(sslReq.data.msisdn, "8801711111111");
    assert.strictEqual(sslReq.isSuccess({ status: "SUCCESS", status_code: 200 }), true);
    assert.strictEqual(sslReq.isSuccess({ status: "FAILED", status_code: 400 }), false);
  }

  console.log("ALL ATTENDANCE AUTO-SMS UNIT TESTS PASSED!");
};

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
