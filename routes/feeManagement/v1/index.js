const router = require("express").Router();
const root = process.cwd();
const Joi = require("joi");
const { ObjectId } = require("mongodb");

const validate = require(`${root}/middleware/validate`);
const authMiddleware = require(`${root}/middleware/authenticate`);
const tenantMiddleware = require(`${root}/middleware/tenantMiddleware`);
const rbacMiddleware = require(`${root}/middleware/rbacMiddleware`);
const mongoConnect = require(`${root}/services/mongo-connect`);
const mongo = require(`${root}/services/mongo-crud`);

// Schemas
const generateSchema = Joi.object({
    class_id: Joi.string().required(),
    month: Joi.string().required(), // e.g., "January", "February"
    year: Joi.string().required()
});

const collectSchema = Joi.object({
    student_id: Joi.string().required(),
    fee_ids: Joi.array().items(Joi.any()).optional().default([]),
    paid_amount: Joi.number().min(0).required(),
    discount: Joi.number().min(0).default(0),
    payment_method: Joi.string().required(),
    account_id: Joi.string().allow("", null).optional(),
    is_simple_flow: Joi.boolean().optional(),
    fee_details: Joi.array().optional(),
    receipt_no: Joi.string().allow("", null).optional(),
    months: Joi.array().items(Joi.string()).optional(),
    year: Joi.string().allow("", null).optional(),
    subtotal: Joi.number().optional(),
    net_payable: Joi.number().optional(),
    remaining_due: Joi.number().optional(),
    previous_due: Joi.number().optional(),
    advance_amount: Joi.number().optional(),
    remarks: Joi.string().allow("", null).optional(),
    date: Joi.date().optional()
});

// Helper: Convert Month Name to Index
const getMonthIndex = (monthStr) => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const idx = months.findIndex(m => m.toLowerCase().includes(monthStr.toLowerCase()));
    return idx === -1 ? 0 : idx;
};

// Helper: Query filter for madrasa_id that matches both ObjectId and string representations
const getMadrasaFilter = (madrasaId) => {
    if (!madrasaId) return madrasaId;
    return ObjectId.isValid(madrasaId)
        ? { $in: [madrasaId.toString(), new ObjectId(madrasaId)] }
        : madrasaId;
};

// 1. Generate Fees for a Class
const generateFees = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const { class_id, month, year } = req.body;
        const madrasaId = req.user.madrasa_id;
        const madrasaFilter = getMadrasaFilter(madrasaId);

        // Fetch Fee Setups for this class
        const feeSetups = await db.collection("fee_setups").aggregate([
            { $match: { class_id, madrasa_id: madrasaFilter } },
            { $addFields: { headObjectId: { $toObjectId: "$head_id" } } },
            {
                $lookup: {
                    from: "fee_heads",
                    localField: "headObjectId",
                    foreignField: "_id",
                    as: "head_info"
                }
            },
            { $unwind: { path: "$head_info", preserveNullAndEmptyArrays: true } }
        ]).toArray();

        if (feeSetups.length === 0) {
            return res.status(400).json({ success: false, message: "No fee setups found for this class. Please setup fees first." });
        }

        // Fetch all active students in this class
        const students = await db.collection("students").find({
            class_id,
            madrasa_id: madrasaFilter,
            admissionStatus: "Active"
        }).toArray();

        if (students.length === 0) {
            return res.status(400).json({ success: false, message: "No active students found in this class." });
        }

        const targetMonthIndex = getMonthIndex(month);
        const targetYear = parseInt(year);

        let generatedCount = 0;
        let skippedCount = 0;

        for (const student of students) {
            // Compare admission date to target month/year
            // If the student joined in March, they shouldn't get billed for Jan or Feb.
            const admissionDate = new Date(student.admissionDate);
            const admissionMonth = admissionDate.getMonth();
            const admissionYear = admissionDate.getFullYear();

            // Skip if admission is after the target period
            if (admissionYear > targetYear || (admissionYear === targetYear && admissionMonth > targetMonthIndex)) {
                skippedCount++;
                continue;
            }

            for (const setup of feeSetups) {
                // Check if an invoice already exists for this student, head, month, year
                const existingFee = await db.collection("student_fees").findOne({
                    student_id: student._id.toString(),
                    fee_setup_id: setup._id.toString(),
                    month: month,
                    year: year,
                    madrasa_id: madrasaFilter
                });

                if (!existingFee) {
                    await db.collection("student_fees").insertOne({
                        student_id: student._id.toString(),
                        madrasa_id: madrasaId,
                        class_id: class_id,
                        fee_setup_id: setup._id.toString(),
                        head_name: setup.head_info?.name || "Unknown Fee",
                        month: month,
                        year: year,
                        amount: setup.amount,
                        discount: 0,
                        paid_amount: 0,
                        status: "Unpaid", // "Unpaid", "Partial", "Paid"
                        transaction_ids: [],
                        created_at: Date.now(),
                        updated_at: Date.now()
                    });
                    generatedCount++;
                }
            }
        }

        res.status(200).json({
            success: true,
            message: `Generated ${generatedCount} fee invoices. Skipped ${skippedCount} students due to later admission dates.`
        });

    } catch (error) {
        console.error("Fee Generation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Get Pending Fees for a Student
const getPendingFees = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const studentId = req.params.studentId;
        const madrasaId = req.user.madrasa_id;
        const madrasaFilter = getMadrasaFilter(madrasaId);

        const pendingFees = await db.collection("student_fees").find({
            student_id: studentId,
            madrasa_id: madrasaFilter,
            status: { $in: ["Unpaid", "Partial"] }
        }).sort({ year: 1, created_at: 1 }).toArray();

        res.status(200).json({ success: true, data: pendingFees });
    } catch (error) {
        console.error("Fetch Pending Fees Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Get Student Fee History & Outstanding Dues
const getStudentFeeHistory = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const studentParam = req.params.studentId;
        const madrasaId = req.user.madrasa_id;
        const madrasaFilter = getMadrasaFilter(madrasaId);

        let studentQuery = { madrasa_id: madrasaFilter };
        if (ObjectId.isValid(studentParam)) {
            studentQuery.$or = [
                { _id: new ObjectId(studentParam) },
                { student_id: studentParam }
            ];
        } else {
            studentQuery.student_id = studentParam;
        }

        const student = await db.collection("students").findOne(studentQuery);
        if (!student) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        // Lookup class and section
        let className = "N/A";
        let sectionName = "N/A";
        if (student.class_id && ObjectId.isValid(student.class_id)) {
            const cls = await db.collection("classes").findOne({ _id: new ObjectId(student.class_id) });
            if (cls) className = cls.name;
        }
        if (student.section_id && ObjectId.isValid(student.section_id)) {
            const sec = await db.collection("sections").findOne({ _id: new ObjectId(student.section_id) });
            if (sec) sectionName = sec.name;
        }

        // Fetch transactions for this student
        const idStrings = [student._id.toString(), student.student_id].filter(Boolean);
        const transactions = await db.collection("transactions").find({
            madrasa_id: madrasaFilter,
            category: "Fee",
            $or: [
                { reference_id: { $in: idStrings } },
                { student_id: { $in: idStrings } }
            ]
        }).sort({ date: -1, created_at: -1 }).toArray();

        // Only active (non-voided) transactions affect current dues and paid status
        const activeTransactions = transactions.filter(tx => tx.status !== "Voided" && !tx.is_voided);

        // Calculate current pending due from latest active transaction or student record
        let currentDue = student.pendingDue !== undefined ? Number(student.pendingDue) : 0;
        if (activeTransactions.length > 0 && activeTransactions[0].remaining_due !== undefined) {
            currentDue = Number(activeTransactions[0].remaining_due);
        }

        // Build summary of paid months and annual fees
        const paidMonthsSummary = {};
        const annualHeadsPaid = {};

        activeTransactions.forEach((tx) => {
            const txYear = tx.year ? tx.year.toString() : (tx.date ? new Date(tx.date).getFullYear().toString() : new Date().getFullYear().toString());
            const isFullyPaid = (Number(tx.remaining_due) === 0 && Number(tx.amount) > 0) || (Number(tx.amount) >= Number(tx.net_payable) && Number(tx.amount) > 0);
            const isPartial = Number(tx.amount) > 0 && Number(tx.remaining_due) > 0;
            const status = isFullyPaid ? "Paid" : (isPartial ? "Partial" : "Unpaid");

            // Check fee_details
            if (tx.fee_details && Array.isArray(tx.fee_details)) {
                tx.fee_details.forEach((fd) => {
                    const periodStr = fd.period || fd.month || "";
                    // Check for month names in periodStr
                    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                    months.forEach((m) => {
                        if (periodStr.toLowerCase().includes(m.toLowerCase())) {
                            const key = `${m}-${txYear}`;
                            if (!paidMonthsSummary[key] || paidMonthsSummary[key].status !== "Paid") {
                                paidMonthsSummary[key] = {
                                    month: m,
                                    year: txYear,
                                    status: status,
                                    paid_amount: tx.amount,
                                    remaining_due: tx.remaining_due || 0,
                                    receipt_no: tx.receipt_no,
                                    date: tx.date || tx.created_at,
                                    transaction_id: tx._id
                                };
                            }
                        }
                    });

                    // Track if this is an annual/one-time fee head
                    if (isFullyPaid || isPartial) {
                        const headKey = `${fd.head}-${txYear}`;
                        if (!annualHeadsPaid[headKey]) {
                            annualHeadsPaid[headKey] = {
                                head: fd.head,
                                year: txYear,
                                receipt_no: tx.receipt_no,
                                date: tx.date || tx.created_at,
                                amount: fd.amount
                            };
                        }
                    }
                });
            }

            // Also check tx.months array
            if (tx.months && Array.isArray(tx.months)) {
                tx.months.forEach((m) => {
                    const key = `${m}-${txYear}`;
                    if (!paidMonthsSummary[key] || paidMonthsSummary[key].status !== "Paid") {
                        paidMonthsSummary[key] = {
                            month: m,
                            year: txYear,
                            status: status,
                            paid_amount: tx.amount,
                            remaining_due: tx.remaining_due || 0,
                            receipt_no: tx.receipt_no,
                            date: tx.date || tx.created_at,
                            transaction_id: tx._id
                        };
                    }
                });
            }
        });

        // Propagate subsequent due settlements to paidMonthsSummary
        const chronTx = [...activeTransactions].sort((a, b) => {
            const tA = new Date(a.date || a.created_at || 0).getTime();
            const tB = new Date(b.date || b.created_at || 0).getTime();
            return tA - tB;
        });

        Object.keys(paidMonthsSummary).forEach((key) => {
            const summaryItem = paidMonthsSummary[key];
            if (summaryItem.status === "Partial" || Number(summaryItem.remaining_due) > 0) {
                let remDue = Number(summaryItem.remaining_due) || 0;
                const itemTime = new Date(summaryItem.date || 0).getTime();

                if (currentDue === 0) {
                    remDue = 0;
                } else {
                    const subTxs = chronTx.filter((t) => new Date(t.date || t.created_at || 0).getTime() > itemTime);
                    for (const sTx of subTxs) {
                        const sRem = Number(sTx.remaining_due) || 0;
                        const sPrev = Number(sTx.previous_due) || 0;
                        const sPaid = Number(sTx.amount) || 0;

                        if (sRem === 0) {
                            remDue = 0;
                            break;
                        }

                        if (sPrev > 0) {
                            if (sPaid >= sPrev) {
                                remDue = 0;
                                break;
                            } else {
                                const cleared = Math.min(remDue, Math.max(0, sPaid));
                                remDue = Math.max(0, remDue - cleared);
                            }
                        }

                        remDue = Math.min(remDue, sRem);
                        if (remDue === 0) break;
                    }

                    remDue = Math.min(remDue, currentDue);
                }

                if (remDue === 0) {
                    summaryItem.status = "Paid";
                    summaryItem.remaining_due = 0;
                } else {
                    summaryItem.remaining_due = remDue;
                }
            }
        });

        res.status(200).json({
            success: true,
            data: {
                student: {
                    ...student,
                    class_name: className,
                    section_name: sectionName
                },
                transactions,
                previous_due: currentDue,
                paid_months_summary: paidMonthsSummary,
                annual_heads_paid: annualHeadsPaid
            }
        });
    } catch (error) {
        console.error("Get Student Fee History Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Collect Fee (Checkout)
const collectFee = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const { student_id, fee_ids, paid_amount, discount, payment_method, account_id } = req.body;
        const madrasaId = req.user.madrasa_id;
        const madrasaFilter = getMadrasaFilter(madrasaId);

        // Verify or auto-resolve deposit account
        let targetAccountId = account_id;
        let account = null;

        if (targetAccountId && ObjectId.isValid(targetAccountId)) {
            account = await db.collection("accounts").findOne({
                _id: new ObjectId(targetAccountId),
                madrasa_id: madrasaFilter
            });
        }

        // Fallback: search for Cash account in this madrasa
        if (!account) {
            account = await db.collection("accounts").findOne({
                madrasa_id: madrasaFilter,
                type: "Cash"
            });
        }

        // Fallback: any account in this madrasa
        if (!account) {
            account = await db.collection("accounts").findOne({ madrasa_id: madrasaFilter });
        }

        // If still no account, auto-seed "Main Cash"
        if (!account) {
            const defaultAcc = {
                name: "Main Cash (মেইন ক্যাশ)",
                type: "Cash",
                account_number: "",
                bank_name: "",
                branch_name: "",
                balance: 0,
                status: "Active",
                description: "Default Cash Account",
                madrasa_id: madrasaId,
                created_at: Date.now(),
                updated_at: Date.now()
            };
            const insertResult = await db.collection("accounts").insertOne(defaultAcc);
            defaultAcc._id = insertResult.insertedId;
            account = defaultAcc;
        }

        targetAccountId = account._id.toString();

        // Fetch student details for enriched metadata
        let studentQuery = { madrasa_id: madrasaFilter };
        if (ObjectId.isValid(student_id)) {
            studentQuery.$or = [{ _id: new ObjectId(student_id) }, { student_id: student_id }];
        } else {
            studentQuery.student_id = student_id;
        }
        const student = await db.collection("students").findOne(studentQuery);
        const studentName = student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : "Student";
        const studentRoll = student?.roll_number || "";
        const studentCode = student?.student_id || student_id;

        // Generate receipt number if not provided
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const receiptNo = req.body.receipt_no || `REC-${dateStr}-${randomNum}`;

        const paidAmountNum = Number(paid_amount) || 0;
        const discountNum = Number(discount) || 0;
        const subtotalNum = Number(req.body.subtotal) || paidAmountNum;
        const previousDueNum = Number(req.body.previous_due) || 0;
        const advanceAmountNum = Number(req.body.advance_amount) || 0;
        const netPayableNum = Number(req.body.net_payable) || paidAmountNum;
        const remainingDueNum = Number(req.body.remaining_due) || 0;

        // Create Transaction
        const transactionData = {
            madrasa_id: madrasaId,
            type: "Income",
            category: "Fee",
            account_id: targetAccountId,
            account_name: account.name || "Main Cash",
            amount: paidAmountNum,
            payment_method: payment_method,
            receipt_no: receiptNo,
            description: `Fee Collection for ${studentName} (${studentCode}) - ${receiptNo}`,
            fee_details: req.body.fee_details || [],
            months: req.body.months || [],
            year: req.body.year || (req.body.date ? new Date(req.body.date).getFullYear().toString() : new Date().getFullYear().toString()),
            subtotal: subtotalNum,
            discount: discountNum,
            previous_due: previousDueNum,
            advance_amount: advanceAmountNum,
            net_payable: netPayableNum,
            remaining_due: remainingDueNum,
            remarks: req.body.remarks || "",
            reference_id: student?._id ? student._id.toString() : student_id,
            student_id: studentCode,
            student_name: studentName,
            student_roll: studentRoll,
            date: req.body.date ? new Date(req.body.date) : new Date(),
            created_at: Date.now(),
            updated_at: Date.now()
        };
        const transResult = await db.collection("transactions").insertOne(transactionData);
        const transactionId = transResult.insertedId.toString();

        // Update Account Balance
        if (paidAmountNum > 0) {
            await db.collection("accounts").updateOne(
                { _id: new ObjectId(targetAccountId) },
                { $inc: { balance: paidAmountNum } }
            );
        }

        // Update student pending due balance
        if (student) {
            await db.collection("students").updateOne(
                { _id: student._id },
                { $set: { pendingDue: remainingDueNum, updated_at: Date.now() } }
            );
        }

        // If invoices exist in student_fees and not simple flow, update them
        if (!req.body.is_simple_flow && fee_ids && fee_ids.length > 0) {
            const validObjIds = fee_ids.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
            if (validObjIds.length > 0) {
                const feesToPay = await db.collection("student_fees").find({
                    _id: { $in: validObjIds },
                    madrasa_id: madrasaFilter
                }).toArray();

                let remainingToApply = paidAmountNum + discountNum;
                for (const fee of feesToPay) {
                    if (remainingToApply <= 0) break;
                    const feeDue = fee.amount - fee.paid_amount;
                    const amountToApply = Math.min(remainingToApply, feeDue);
                    remainingToApply -= amountToApply;

                    const newPaid = fee.paid_amount + amountToApply;
                    const newStatus = (newPaid >= fee.amount) ? "Paid" : "Partial";

                    await db.collection("student_fees").updateOne(
                        { _id: fee._id },
                        {
                            $set: {
                                paid_amount: newPaid,
                                status: newStatus,
                                updated_at: Date.now()
                            },
                            $push: { transaction_ids: transactionId }
                        }
                    );
                }
            }
        }

        res.status(200).json({
            success: true,
            message: "Fee collected and accounted successfully",
            transaction_id: transactionId,
            receipt_no: receiptNo,
            data: transactionData
        });

    } catch (error) {
        console.error("Fee Collection Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Void / Cancel Fee Transaction with Audit Trail and Auto-Rollback
const voidTransaction = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const transId = req.params.id;
        const { reason } = req.body || {};
        const madrasaId = req.user.madrasa_id;
        const madrasaFilter = getMadrasaFilter(madrasaId);

        if (!ObjectId.isValid(transId)) {
            return res.status(400).json({ success: false, message: "Invalid transaction ID" });
        }

        const transaction = await db.collection("transactions").findOne({
            _id: new ObjectId(transId),
            madrasa_id: madrasaFilter
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }

        if (transaction.status === "Voided" || transaction.is_voided) {
            return res.status(400).json({ success: false, message: "Transaction is already voided" });
        }

        const paidAmountNum = Number(transaction.amount) || 0;
        const targetAccountId = transaction.account_id;

        // 1. Rollback Account Balance
        if (paidAmountNum > 0 && targetAccountId && ObjectId.isValid(targetAccountId)) {
            await db.collection("accounts").updateOne(
                { _id: new ObjectId(targetAccountId), madrasa_id: madrasaFilter },
                { $inc: { balance: -paidAmountNum } }
            );
        }

        // 2. Mark Transaction as Voided with audit trail
        const voidMetadata = {
            status: "Voided",
            is_voided: true,
            voided_at: Date.now(),
            voided_by: req.user._id ? req.user._id.toString() : (req.user.id || "System"),
            voided_by_name: req.user.name || req.user.username || "Staff",
            void_reason: reason || "Voided by user",
            updated_at: Date.now()
        };

        await db.collection("transactions").updateOne(
            { _id: new ObjectId(transId) },
            { $set: voidMetadata }
        );

        // 3. Rollback student pendingDue
        const studentQuery = {
            madrasa_id: madrasaFilter,
            $or: [
                ...(ObjectId.isValid(transaction.reference_id) ? [{ _id: new ObjectId(transaction.reference_id) }] : []),
                ...(transaction.student_id ? [{ student_id: transaction.student_id }] : [])
            ]
        };
        const student = await db.collection("students").findOne(studentQuery);

        if (student) {
            const idStrings = [student._id.toString(), student.student_id].filter(Boolean);
            const activeTxs = await db.collection("transactions").find({
                madrasa_id: madrasaFilter,
                category: "Fee",
                status: { $ne: "Voided" },
                $or: [
                    { reference_id: { $in: idStrings } },
                    { student_id: { $in: idStrings } }
                ]
            }).sort({ date: -1, created_at: -1 }).toArray();

            let restoredDue = 0;
            if (activeTxs.length > 0 && activeTxs[0].remaining_due !== undefined) {
                restoredDue = Number(activeTxs[0].remaining_due);
            } else {
                restoredDue = Number(transaction.previous_due) || 0;
            }

            await db.collection("students").updateOne(
                { _id: student._id },
                { $set: { pendingDue: restoredDue, updated_at: Date.now() } }
            );
        }

        // 4. Rollback any linked student_fees if applicable
        await db.collection("student_fees").updateMany(
            { transaction_ids: transId },
            { $pull: { transaction_ids: transId } }
        );

        res.status(200).json({
            success: true,
            message: "Transaction voided and accounts successfully rolled back",
            data: {
                transaction_id: transId,
                ...voidMetadata
            }
        });
    } catch (error) {
        console.error("Void Transaction Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Routes
router.use(authMiddleware);
router.use(tenantMiddleware);

router.post("/generate", rbacMiddleware(["admin", "accountant"]), validate(generateSchema), generateFees);
router.get("/pending/:studentId", rbacMiddleware(["admin", "accountant"]), getPendingFees);
router.get("/student-history/:studentId", rbacMiddleware(["admin", "accountant"]), getStudentFeeHistory);
router.post("/collect", rbacMiddleware(["admin", "accountant"]), validate(collectSchema), collectFee);
router.post("/void-transaction/:id", rbacMiddleware(["admin", "accountant"]), voidTransaction);

module.exports = router;
