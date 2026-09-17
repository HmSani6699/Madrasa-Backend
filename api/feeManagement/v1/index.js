const router = require("express").Router();
const root = require("app-root-path");
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

// 1. Generate Fees for a Class
const generateFees = async (req, res) => {
    try {
        const { db } = await mongoConnect();
        const { class_id, month, year } = req.body;
        const madrasaId = req.user.madrasa_id;

        // Fetch Fee Setups for this class
        const feeSetups = await db.collection("fee_setups").aggregate([
            { $match: { class_id, madrasa_id: madrasaId } },
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
            madrasa_id: madrasaId, 
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
                    madrasa_id: madrasaId
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

        const pendingFees = await db.collection("student_fees").find({
            student_id: studentId,
            madrasa_id: madrasaId,
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

        let studentQuery = { madrasa_id: madrasaId };
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
            madrasa_id: madrasaId,
            category: "Fee",
            $or: [
                { reference_id: { $in: idStrings } },
                { student_id: { $in: idStrings } }
            ]
        }).sort({ date: -1, created_at: -1 }).toArray();

        // Calculate current pending due from latest transaction or student record
        let currentDue = student.pendingDue !== undefined ? Number(student.pendingDue) : 0;
        if (transactions.length > 0 && transactions[0].remaining_due !== undefined) {
            currentDue = Number(transactions[0].remaining_due);
        }

        res.status(200).json({
            success: true,
            data: {
                student: {
                    ...student,
                    class_name: className,
                    section_name: sectionName
                },
                transactions,
                previous_due: currentDue
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

        // Verify or auto-resolve deposit account
        let targetAccountId = account_id;
        let account = null;

        if (targetAccountId && ObjectId.isValid(targetAccountId)) {
            account = await db.collection("accounts").findOne({ 
                _id: new ObjectId(targetAccountId), 
                madrasa_id: madrasaId 
            });
        }

        // Fallback: search for Cash account in this madrasa
        if (!account) {
            account = await db.collection("accounts").findOne({ 
                madrasa_id: madrasaId,
                type: "Cash"
            });
        }

        // Fallback: any account in this madrasa
        if (!account) {
            account = await db.collection("accounts").findOne({ madrasa_id: madrasaId });
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
        let studentQuery = { madrasa_id: madrasaId };
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
                    madrasa_id: madrasaId
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

// Routes
router.use(authMiddleware);
router.use(tenantMiddleware);

router.post("/generate", rbacMiddleware(["admin", "accountant"]), validate(generateSchema), generateFees);
router.get("/pending/:studentId", rbacMiddleware(["admin", "accountant"]), getPendingFees);
router.get("/student-history/:studentId", rbacMiddleware(["admin", "accountant"]), getStudentFeeHistory);
router.post("/collect", rbacMiddleware(["admin", "accountant"]), validate(collectSchema), collectFee);

module.exports = router;
