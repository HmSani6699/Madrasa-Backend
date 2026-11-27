const router = require("express").Router();
const root = process.cwd();
const { ObjectId } = require("mongodb");

const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const allowedRoles = ["admin", "mohtamim", "accountant"];

const getMadrasaFilter = (madrasaId) => {
  if (!madrasaId) return madrasaId;
  return ObjectId.isValid(madrasaId)
    ? { $in: [madrasaId.toString(), new ObjectId(madrasaId)] }
    : madrasaId;
};

const toDateStr = (d) => {
  if (!d) return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
    return dt.toISOString().split("T")[0];
  } catch {
    return "";
  }
};

const matchesDateFilter = (dateStr, { month, year, start_date, end_date }) => {
  if (!dateStr) return !month && !year && !start_date && !end_date;
  if (month && month !== "all" && month !== "All") {
    if (/^\d{4}-\d{2}$/.test(month)) {
      if (!dateStr.startsWith(month)) return false;
    } else {
      const mNames = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
      ];
      const idx = mNames.indexOf(String(month).toLowerCase());
      if (idx !== -1) {
        const dtMonth = new Date(dateStr).getMonth();
        if (dtMonth !== idx) return false;
      } else {
        const numMonth = parseInt(month, 10);
        if (!Number.isNaN(numMonth) && new Date(dateStr).getMonth() + 1 !== numMonth) {
          return false;
        }
      }
    }
  }
  if (year && year !== "all" && year !== "All") {
    if (!dateStr.startsWith(String(year))) return false;
  }
  if (start_date && dateStr < start_date) return false;
  if (end_date && dateStr > end_date) return false;
  return true;
};

/* =========================
   1. FEE COLLECTION REPORT
========================= */
const getFeeCollectionReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [transactions, students, classes, sections] = await Promise.all([
      db
        .collection("transactions")
        .find({ madrasa_id: madrasaFilter, category: "Fee" })
        .sort({ date: -1, created_at: -1 })
        .toArray(),
      db.collection("students").find({ madrasa_id: madrasaFilter }).toArray(),
      db.collection("classes").find({ madrasa_id: madrasaFilter }).sort({ name: 1 }).toArray(),
      db.collection("sections").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const classMap = new Map(classes.map((c) => [c._id.toString(), c.name]));
    const sectionMap = new Map(sections.map((s) => [s._id.toString(), s.name]));
    const studentById = new Map();
    const studentByCode = new Map();

    for (const st of students) {
      const enriched = {
        _id: st._id.toString(),
        student_code: st.student_id || "",
        name: `${st.firstName || ""} ${st.lastName || ""}`.trim() || "Student",
        roll_number: st.roll_number || "",
        class_id: st.class_id ? st.class_id.toString() : "",
        class_name: st.class_id ? classMap.get(st.class_id.toString()) || "N/A" : "N/A",
        section_name: st.section_id ? sectionMap.get(st.section_id.toString()) || "" : "",
      };
      studentById.set(st._id.toString(), enriched);
      if (st.student_id) studentByCode.set(st.student_id, enriched);
    }

    const { class_id, status, payment_method, month, year, start_date, end_date, search } = req.query;

    let rows = transactions.map((tx) => {
      const st =
        studentById.get(String(tx.reference_id || "")) ||
        studentByCode.get(String(tx.student_id || "")) ||
        null;

      const isVoided = Boolean(tx.is_voided || tx.status === "Voided");
      const paid = Number(tx.amount || 0);
      const discount = Number(tx.discount || 0);
      const remainingDue = Number(tx.remaining_due || 0);
      const netPayable = Number(tx.net_payable || paid);
      const subtotal = Number(tx.subtotal || paid + discount);

      let rowStatus = "Paid";
      if (isVoided) rowStatus = "Voided";
      else if (remainingDue > 0 && paid > 0) rowStatus = "Partial";
      else if (remainingDue > 0 && paid === 0) rowStatus = "Unpaid";

      const feeHeads = Array.isArray(tx.fee_details) && tx.fee_details.length > 0
        ? tx.fee_details.map((f) => f.head || f.name).filter(Boolean).join(", ")
        : "Fee Collection";

      const monthsText = Array.isArray(tx.months) && tx.months.length > 0
        ? tx.months.join(", ")
        : "";

      const dateStr = toDateStr(tx.date || tx.created_at);

      return {
        _id: tx._id.toString(),
        receipt_no: tx.receipt_no || "-",
        date: dateStr,
        student_id: st?._id || tx.reference_id || "",
        student_code: st?.student_code || tx.student_id || "-",
        student_name: st?.name || tx.student_name || "Student",
        roll_number: st?.roll_number || tx.student_roll || "",
        class_id: st?.class_id || "",
        class_name: st?.class_name || "N/A",
        section_name: st?.section_name || "",
        fee_heads: feeHeads,
        fee_details: tx.fee_details || [],
        months: tx.months || [],
        months_text: monthsText,
        year: tx.year || (dateStr ? dateStr.slice(0, 4) : ""),
        subtotal,
        discount,
        previous_due: Number(tx.previous_due || 0),
        net_payable: netPayable,
        paid_amount: paid,
        remaining_due: remainingDue,
        payment_method: tx.payment_method || "Cash",
        account_name: tx.account_name || "Main Cash",
        remarks: tx.remarks || "",
        status: rowStatus,
        is_voided: isVoided,
      };
    });

    // Apply filters
    rows = rows.filter((r) => {
      if (class_id && class_id !== "all" && r.class_id !== class_id) return false;
      if (status && status !== "all" && r.status.toLowerCase() !== status.toLowerCase()) return false;
      if (
        payment_method &&
        payment_method !== "all" &&
        r.payment_method.toLowerCase() !== payment_method.toLowerCase()
      ) {
        return false;
      }
      if (!matchesDateFilter(r.date, { month, year, start_date, end_date })) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.student_name.toLowerCase().includes(q) ||
          r.student_code.toLowerCase().includes(q) ||
          r.receipt_no.toLowerCase().includes(q) ||
          r.fee_heads.toLowerCase().includes(q) ||
          r.roll_number.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    const activeRows = rows.filter((r) => !r.is_voided);
    const summary = {
      totalCollected: activeRows.reduce((s, r) => s + r.paid_amount, 0),
      totalDiscount: activeRows.reduce((s, r) => s + r.discount, 0),
      totalNetPayable: activeRows.reduce((s, r) => s + r.net_payable, 0),
      totalDue: activeRows.reduce((s, r) => s + r.remaining_due, 0),
      receiptCount: activeRows.length,
      voidedCount: rows.filter((r) => r.is_voided).length,
    };

    res.status(200).json({
      success: true,
      data: rows,
      summary,
      classes: classes.map((c) => ({ _id: c._id.toString(), name: c.name })),
    });
  } catch (error) {
    console.error("Fee Collection Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   2. DUE FEES REPORT
========================= */
const getDueFeesReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [students, classes, sections, parents, studentFees, boardingBills, transportBills] =
      await Promise.all([
        db.collection("students").find({ madrasa_id: madrasaFilter }).toArray(),
        db.collection("classes").find({ madrasa_id: madrasaFilter }).sort({ name: 1 }).toArray(),
        db.collection("sections").find({ madrasa_id: madrasaFilter }).toArray(),
        db.collection("parents").find({ madrasa_id: madrasaFilter }).toArray(),
        db
          .collection("student_fees")
          .find({ madrasa_id: madrasaFilter, status: { $in: ["Unpaid", "Partial"] } })
          .toArray(),
        db
          .collection("boarding_bills")
          .find({ madrasa_id: madrasaFilter, status: { $in: ["Unpaid", "Partial"] } })
          .toArray(),
        db
          .collection("transport_bills")
          .find({ madrasa_id: madrasaFilter, status: { $in: ["Unpaid", "Partial"] } })
          .toArray(),
      ]);

    const classMap = new Map(classes.map((c) => [c._id.toString(), c.name]));
    const sectionMap = new Map(sections.map((s) => [s._id.toString(), s.name]));
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));

    const invoiceDueMap = new Map();
    for (const sf of studentFees) {
      const sid = String(sf.student_id || "");
      const due = Math.max(0, Number(sf.amount || 0) - Number(sf.discount || 0) - Number(sf.paid_amount || 0));
      invoiceDueMap.set(sid, (invoiceDueMap.get(sid) || 0) + due);
    }

    const boardingDueMap = new Map();
    const boardingMonthsMap = new Map();
    for (const bb of boardingBills) {
      const sid = String(bb.student_id || "");
      const due = Number(bb.due_amount || 0);
      if (due > 0) {
        boardingDueMap.set(sid, (boardingDueMap.get(sid) || 0) + due);
        const list = boardingMonthsMap.get(sid) || [];
        if (bb.month) list.push(bb.month);
        boardingMonthsMap.set(sid, list);
      }
    }

    const transportDueMap = new Map();
    const transportMonthsMap = new Map();
    for (const tb of transportBills) {
      const sid = String(tb.student_id || "");
      const due = Number(tb.due_amount || 0);
      if (due > 0) {
        transportDueMap.set(sid, (transportDueMap.get(sid) || 0) + due);
        const list = transportMonthsMap.get(sid) || [];
        if (tb.month) list.push(tb.month);
        transportMonthsMap.set(sid, list);
      }
    }

    const { class_id, due_type, search } = req.query;

    let rows = students
      .map((st) => {
        const sid = st._id.toString();
        const tuitionDue =
          st.pendingDue !== undefined
            ? Math.max(0, Number(st.pendingDue || 0))
            : invoiceDueMap.get(sid) || 0;
        const boardingDue = boardingDueMap.get(sid) || 0;
        const transportDue = transportDueMap.get(sid) || 0;
        const totalDue = tuitionDue + boardingDue + transportDue;

        const parent = st.guardian_id ? parentMap.get(st.guardian_id.toString()) : null;

        return {
          _id: sid,
          student_code: st.student_id || sid.slice(-6).toUpperCase(),
          name: `${st.firstName || ""} ${st.lastName || ""}`.trim() || "Student",
          roll_number: st.roll_number || "-",
          class_id: st.class_id ? st.class_id.toString() : "",
          class_name: st.class_id ? classMap.get(st.class_id.toString()) || "N/A" : "N/A",
          section_name: st.section_id ? sectionMap.get(st.section_id.toString()) || "" : "",
          guardian_name: parent?.fatherName || parent?.motherName || "-",
          guardian_phone: parent?.contact || st.phone || "-",
          admission_status: st.admissionStatus || "Active",
          tuition_due: tuitionDue,
          boarding_due: boardingDue,
          transport_due: transportDue,
          total_due: totalDue,
          boarding_months: boardingMonthsMap.get(sid) || [],
          transport_months: transportMonthsMap.get(sid) || [],
        };
      })
      .filter((r) => r.total_due > 0);

    rows = rows.filter((r) => {
      if (class_id && class_id !== "all" && r.class_id !== class_id) return false;
      if (due_type === "tuition" && r.tuition_due <= 0) return false;
      if (due_type === "boarding" && r.boarding_due <= 0) return false;
      if (due_type === "transport" && r.transport_due <= 0) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.name.toLowerCase().includes(q) ||
          r.student_code.toLowerCase().includes(q) ||
          r.roll_number.toLowerCase().includes(q) ||
          r.guardian_phone.toLowerCase().includes(q) ||
          r.guardian_name.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    rows.sort((a, b) => b.total_due - a.total_due);

    const summary = {
      totalStudents: rows.length,
      totalTuitionDue: rows.reduce((s, r) => s + r.tuition_due, 0),
      totalBoardingDue: rows.reduce((s, r) => s + r.boarding_due, 0),
      totalTransportDue: rows.reduce((s, r) => s + r.transport_due, 0),
      grandTotalDue: rows.reduce((s, r) => s + r.total_due, 0),
    };

    res.status(200).json({
      success: true,
      data: rows,
      summary,
      classes: classes.map((c) => ({ _id: c._id.toString(), name: c.name })),
    });
  } catch (error) {
    console.error("Due Fees Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   3. SALARY & ADVANCE REPORT
========================= */
const getSalaryReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [monthlySalaries, advances, staffList] = await Promise.all([
      db
        .collection("monthly_salaries")
        .find({ madrasa_id: madrasaFilter })
        .sort({ year: -1, month: -1, created_at: -1 })
        .toArray(),
      db
        .collection("salary_advances")
        .find({ madrasa_id: madrasaFilter })
        .sort({ date: -1, created_at: -1 })
        .toArray(),
      db.collection("staff").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const staffMap = new Map(staffList.map((s) => [s._id.toString(), s]));
    const { month, year, status, search } = req.query;

    let salaryRows = monthlySalaries.map((rec) => {
      const st = rec.staff_id ? staffMap.get(rec.staff_id.toString()) : null;
      const deductions = Number(rec.absent_deduction || 0) + Number(rec.advance_deduction || 0);
      return {
        _id: rec._id.toString(),
        staff_id: rec.staff_id ? rec.staff_id.toString() : "",
        employee_id: st?.employeeID || "-",
        staff_name: st?.name || "Staff",
        designation: st?.designation || st?.role || "-",
        department: st?.department || "-",
        phone: st?.phone || "-",
        month: Number(rec.month),
        year: Number(rec.year),
        basic_salary: Number(rec.basic_salary || 0),
        allowances:
          Number(rec.house_rent || 0) +
          Number(rec.medical_allowance || 0) +
          Number(rec.transport_allowance || 0) +
          Number(rec.other_allowance || 0),
        gross_salary: Number(rec.gross_salary || 0),
        bonus: Number(rec.bonus || 0),
        absent_deduction: Number(rec.absent_deduction || 0),
        advance_deduction: Number(rec.advance_deduction || 0),
        total_deductions: deductions,
        net_payable: Number(rec.net_payable || 0),
        paid_amount: Number(rec.paid_amount || 0),
        remaining_due: Number(rec.remaining_due || 0),
        status: rec.status || "unpaid",
        last_payment_date: rec.last_payment_date ? toDateStr(rec.last_payment_date) : "-",
        note: rec.note || "",
      };
    });

    salaryRows = salaryRows.filter((r) => {
      if (month && month !== "all" && month !== "All" && r.month !== parseInt(month, 10)) {
        return false;
      }
      if (year && year !== "all" && year !== "All" && r.year !== parseInt(year, 10)) {
        return false;
      }
      if (status && status !== "all" && status !== "All" && r.status.toLowerCase() !== status.toLowerCase()) {
        return false;
      }
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.staff_name.toLowerCase().includes(q) ||
          r.employee_id.toLowerCase().includes(q) ||
          r.designation.toLowerCase().includes(q) ||
          r.phone.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    let advanceRows = advances.map((adv) => {
      const st = adv.staff_id ? staffMap.get(adv.staff_id.toString()) : null;
      return {
        _id: adv._id.toString(),
        staff_id: adv.staff_id ? adv.staff_id.toString() : "",
        employee_id: st?.employeeID || "-",
        staff_name: st?.name || "Staff",
        designation: st?.designation || st?.role || "-",
        amount: Number(adv.amount || 0),
        recovered_amount: Number(adv.recovered_amount || 0),
        balance: Number(adv.balance || 0),
        payment_method: adv.payment_method || "Cash",
        reason: adv.reason || "-",
        date: toDateStr(adv.date || adv.created_at),
        status: adv.status || "active",
      };
    });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      advanceRows = advanceRows.filter(
        (r) =>
          r.staff_name.toLowerCase().includes(q) ||
          r.employee_id.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)
      );
    }

    const summary = {
      totalRecords: salaryRows.length,
      totalGross: salaryRows.reduce((s, r) => s + r.gross_salary, 0),
      totalBonus: salaryRows.reduce((s, r) => s + r.bonus, 0),
      totalDeductions: salaryRows.reduce((s, r) => s + r.total_deductions, 0),
      totalNetPayable: salaryRows.reduce((s, r) => s + r.net_payable, 0),
      totalPaid: salaryRows.reduce((s, r) => s + r.paid_amount, 0),
      totalDue: salaryRows.reduce((s, r) => s + r.remaining_due, 0),
      paidCount: salaryRows.filter((r) => r.status === "paid").length,
      partialCount: salaryRows.filter((r) => r.status === "partial").length,
      unpaidCount: salaryRows.filter((r) => r.status === "unpaid").length,
      totalAdvanceGiven: advanceRows.reduce((s, r) => s + r.amount, 0),
      totalAdvanceBalance: advanceRows.reduce((s, r) => s + r.balance, 0),
    };

    res.status(200).json({
      success: true,
      data: salaryRows,
      advances: advanceRows,
      summary,
    });
  } catch (error) {
    console.error("Salary Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   4. DONATION REPORT
========================= */
const getDonationReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const donations = await db
      .collection("donations")
      .find({ madrasa_id: madrasaFilter })
      .sort({ date: -1, created_at: -1 })
      .toArray();

    const { type, payment_mode, month, year, start_date, end_date, search } = req.query;

    let rows = donations.map((d) => ({
      _id: d._id.toString(),
      receiptNo: d.receiptNo || d.receipt_no || "-",
      donorName: d.donorName || d.donor_name || "Donor",
      phone: d.phone || "",
      address: d.address || "",
      amount: Number(d.amount || 0),
      type: d.type || "general",
      paymentMode: d.paymentMode || d.payment_mode || "Cash",
      remarks: d.remarks || "",
      date: toDateStr(d.date || d.created_at),
    }));

    const fundTypes = Array.from(new Set(rows.map((r) => r.type).filter(Boolean)));

    rows = rows.filter((r) => {
      if (type && type !== "all" && type !== "All" && r.type !== type) return false;
      if (
        payment_mode &&
        payment_mode !== "all" &&
        payment_mode !== "All" &&
        r.paymentMode.toLowerCase() !== payment_mode.toLowerCase()
      ) {
        return false;
      }
      if (!matchesDateFilter(r.date, { month, year, start_date, end_date })) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.donorName.toLowerCase().includes(q) ||
          r.receiptNo.toLowerCase().includes(q) ||
          r.phone.toLowerCase().includes(q) ||
          r.remarks.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    const uniqueDonors = new Set(rows.map((r) => r.donorName.trim().toLowerCase()).filter(Boolean)).size;
    const byFundType = {};
    for (const r of rows) {
      byFundType[r.type] = (byFundType[r.type] || 0) + r.amount;
    }

    const summary = {
      totalAmount: rows.reduce((s, r) => s + r.amount, 0),
      totalCount: rows.length,
      uniqueDonors,
      byFundType,
    };

    res.status(200).json({
      success: true,
      data: rows,
      fundTypes,
      summary,
    });
  } catch (error) {
    console.error("Donation Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   5. INCOME & EXPENSE REPORT
========================= */
const getIncomeExpenseReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [transactions, bazarItems, accounts] = await Promise.all([
      db
        .collection("transactions")
        .find({
          madrasa_id: madrasaFilter,
          status: { $ne: "Voided" },
          is_voided: { $ne: true },
          type: { $in: ["Income", "Expense"] },
        })
        .sort({ date: -1, created_at: -1 })
        .toArray(),
      db
        .collection("boarding_bazar")
        .find({ madrasa_id: madrasaFilter })
        .sort({ date: -1, created_at: -1 })
        .toArray(),
      db.collection("accounts").find({ madrasa_id: madrasaFilter }).toArray(),
    ]);

    const accountMap = new Map(accounts.map((a) => [a._id.toString(), a.name]));

    const txRows = transactions.map((tx) => ({
      _id: tx._id.toString(),
      date: toDateStr(tx.date || tx.created_at),
      created_at: tx.created_at || 0,
      receipt_no: tx.receipt_no || tx.voucherNo || `TX-${tx._id.toString().slice(-6).toUpperCase()}`,
      type: tx.type, // "Income" | "Expense"
      category: tx.sub_category || tx.category || "General",
      category_group: tx.category || "General",
      title: tx.title || tx.description || tx.category || "-",
      description: tx.description || tx.remarks || "-",
      amount: Number(tx.amount || 0),
      payment_method: tx.payment_method || "Cash",
      account_id: tx.account_id ? tx.account_id.toString() : "",
      account_name: tx.account_name || accountMap.get(String(tx.account_id || "")) || "Main Cash",
      source: tx.source || "system",
    }));

    const bazarRows = bazarItems.map((b) => ({
      _id: `bazar-${b._id.toString()}`,
      date: toDateStr(b.date || b.created_at),
      created_at: b.created_at || 0,
      receipt_no: `BAZ-${b._id.toString().slice(-5).toUpperCase()}`,
      type: "Expense",
      category: "Boarding Bazar",
      category_group: "Boarding Bazar",
      title: b.item_name || "Bazar Purchase",
      description: `${b.item_name} (${b.quantity} ${b.unit || ""})${b.buyer_name ? ` • ${b.buyer_name}` : ""}`,
      amount: Number(b.total_cost || 0),
      payment_method: "Cash",
      account_id: "",
      account_name: "Boarding Cash",
      source: "boarding_bazar",
    }));

    let allRows = [...txRows, ...bazarRows].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.created_at || 0) - (a.created_at || 0);
    });

    const categories = Array.from(new Set(allRows.map((r) => r.category).filter(Boolean)));
    const { type, category, account_id, month, year, start_date, end_date, search } = req.query;

    allRows = allRows.filter((r) => {
      if (type && type !== "all" && type !== "All" && r.type.toLowerCase() !== type.toLowerCase()) {
        return false;
      }
      if (category && category !== "all" && category !== "All" && r.category !== category) {
        return false;
      }
      if (account_id && account_id !== "all" && r.account_id !== account_id) {
        return false;
      }
      if (!matchesDateFilter(r.date, { month, year, start_date, end_date })) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.receipt_no.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    const totalIncome = allRows
      .filter((r) => r.type === "Income")
      .reduce((s, r) => s + r.amount, 0);
    const totalExpense = allRows
      .filter((r) => r.type === "Expense")
      .reduce((s, r) => s + r.amount, 0);

    res.status(200).json({
      success: true,
      data: allRows,
      categories,
      accounts: accounts.map((a) => ({ _id: a._id.toString(), name: a.name, type: a.type })),
      summary: {
        totalIncome,
        totalExpense,
        netBalance: totalIncome - totalExpense,
        count: allRows.length,
      },
    });
  } catch (error) {
    console.error("Income Expense Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   6. ACCOUNTS LEDGER REPORT
========================= */
const getAccountsLedgerReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);

    const [accounts, transactions] = await Promise.all([
      db.collection("accounts").find({ madrasa_id: madrasaFilter }).sort({ name: 1 }).toArray(),
      db
        .collection("transactions")
        .find({
          madrasa_id: madrasaFilter,
          status: { $ne: "Voided" },
          is_voided: { $ne: true },
        })
        .sort({ date: -1, created_at: -1 })
        .toArray(),
    ]);

    const { account_id, type, start_date, end_date, search } = req.query;

    const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

    const accountSummaries = accounts.map((acc) => {
      const aid = acc._id.toString();
      let inflow = 0;
      let outflow = 0;
      let txCount = 0;

      for (const tx of transactions) {
        if (String(tx.account_id || "") === aid) {
          txCount++;
          if (tx.type === "Income") inflow += Number(tx.amount || 0);
          else if (tx.type === "Expense" || tx.type === "Transfer") outflow += Number(tx.amount || 0);
        }
        if (tx.type === "Transfer" && String(tx.transfer_to_account_id || "") === aid) {
          txCount++;
          inflow += Number(tx.amount || 0);
        }
      }

      return {
        _id: aid,
        name: acc.name,
        type: acc.type,
        account_number: acc.account_number || "-",
        bank_name: acc.bank_name || "-",
        branch_name: acc.branch_name || "-",
        balance: Number(acc.balance || 0),
        status: acc.status || "Active",
        totalInflow: inflow,
        totalOutflow: outflow,
        txCount,
      };
    });

    let ledgerRows = transactions.map((tx) => {
      const acc = accountMap.get(String(tx.account_id || ""));
      return {
        _id: tx._id.toString(),
        date: toDateStr(tx.date || tx.created_at),
        receipt_no: tx.receipt_no || tx.voucherNo || `TX-${tx._id.toString().slice(-6).toUpperCase()}`,
        account_id: String(tx.account_id || ""),
        account_name: tx.account_name || acc?.name || "Main Cash",
        account_type: acc?.type || "Cash",
        type: tx.type,
        category: tx.sub_category || tx.category || "General",
        description: tx.title || tx.description || "-",
        payment_method: tx.payment_method || acc?.type || "Cash",
        amount: Number(tx.amount || 0),
      };
    });

    ledgerRows = ledgerRows.filter((r) => {
      if (account_id && account_id !== "all" && r.account_id !== account_id) return false;
      if (type && type !== "all" && r.type.toLowerCase() !== type.toLowerCase()) return false;
      if (!matchesDateFilter(r.date, { start_date, end_date })) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const hit =
          r.description.toLowerCase().includes(q) ||
          r.receipt_no.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.account_name.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    const summary = {
      totalBalance: accountSummaries.reduce((s, a) => s + a.balance, 0),
      totalInflow: accountSummaries.reduce((s, a) => s + a.totalInflow, 0),
      totalOutflow: accountSummaries.reduce((s, a) => s + a.totalOutflow, 0),
      accountCount: accountSummaries.length,
    };

    res.status(200).json({
      success: true,
      accounts: accountSummaries,
      transactions: ledgerRows,
      summary,
    });
  } catch (error) {
    console.error("Accounts Ledger Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   7. BOARDING & TRANSPORT REPORT
========================= */
const getBoardingTransportReport = async (req, res) => {
  try {
    const { db } = await mongoConnect();
    const madrasaFilter = getMadrasaFilter(req.user.madrasa_id);
    const month = req.query.month && req.query.month !== "all" ? req.query.month : "";

    const billQuery = { madrasa_id: madrasaFilter };
    const expenseQuery = { madrasa_id: madrasaFilter };
    if (month) {
      billQuery.month = month;
      expenseQuery.date = new RegExp(`^${month}-`);
    }

    const [boardingBills, boardingBazar, transportBills, transportExpenses] = await Promise.all([
      db.collection("boarding_bills").find(billQuery).sort({ month: -1, student_name: 1 }).toArray(),
      db.collection("boarding_bazar").find(expenseQuery).sort({ date: -1, created_at: -1 }).toArray(),
      db.collection("transport_bills").find(billQuery).sort({ month: -1, student_name: 1 }).toArray(),
      db.collection("transport_expenses").find(expenseQuery).sort({ date: -1, created_at: -1 }).toArray(),
    ]);

    const boardingSummary = {
      totalBilled: boardingBills.reduce((s, b) => s + Number(b.net_payable || 0), 0),
      totalCollected: boardingBills.reduce((s, b) => s + Number(b.paid_amount || 0), 0),
      totalDue: boardingBills.reduce((s, b) => s + Number(b.due_amount || 0), 0),
      totalBazarCost: boardingBazar.reduce((s, b) => s + Number(b.total_cost || 0), 0),
      billCount: boardingBills.length,
      bazarCount: boardingBazar.length,
    };
    boardingSummary.netBalance = boardingSummary.totalCollected - boardingSummary.totalBazarCost;

    const transportSummary = {
      totalBilled: transportBills.reduce((s, b) => s + Number(b.net_payable || 0), 0),
      totalCollected: transportBills.reduce((s, b) => s + Number(b.paid_amount || 0), 0),
      totalDue: transportBills.reduce((s, b) => s + Number(b.due_amount || 0), 0),
      totalExpense: transportExpenses.reduce((s, e) => s + Number(e.amount || 0), 0),
      billCount: transportBills.length,
      expenseCount: transportExpenses.length,
    };
    transportSummary.netBalance = transportSummary.totalCollected - transportSummary.totalExpense;

    res.status(200).json({
      success: true,
      boarding: {
        summary: boardingSummary,
        bills: boardingBills,
        bazar: boardingBazar,
      },
      transport: {
        summary: transportSummary,
        bills: transportBills,
        expenses: transportExpenses,
      },
    });
  } catch (error) {
    console.error("Boarding Transport Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get("/fee-collections", rbacMiddleware(allowedRoles), getFeeCollectionReport);
router.get("/due-fees", rbacMiddleware(allowedRoles), getDueFeesReport);
router.get("/salaries", rbacMiddleware(allowedRoles), getSalaryReport);
router.get("/donations", rbacMiddleware(allowedRoles), getDonationReport);
router.get("/income-expense", rbacMiddleware(allowedRoles), getIncomeExpenseReport);
router.get("/accounts-ledger", rbacMiddleware(allowedRoles), getAccountsLedgerReport);
router.get("/boarding-transport", rbacMiddleware(allowedRoles), getBoardingTransportReport);

module.exports = router;
