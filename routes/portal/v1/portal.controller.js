const root = require("app-root-path");
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const portalController = {
  getPortalData: async (req, res) => {
    const { slug } = req.params;
    const { db } = await mongoConnect();

    try {
      // 1. Find Madrasa by slug
      const madrasa = await db.collection("madrasas").findOne({ slug: slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      // 2. Fetch Portal Settings for this Madrasa
      let settings = await db.collection("portal_settings").findOne({ madrasa_id: madrasa._id });
      
      // Fetch actual classes for form options
      const activeClasses = await db.collection("classes").find({ madrasa_id: madrasa._id }).toArray();
      const activeSections = await db.collection("sections").find({ madrasa_id: madrasa._id }).toArray();

      const classOptions = activeClasses.map(c => ({ 
        value: c._id.toString(), 
        label: c.name,
        sections: activeSections
          .filter(s => s.class_id.toString() === c._id.toString())
          .map(s => ({ value: s._id.toString(), label: s.name }))
      }));

      const defaultSteps = [
        {
          id: "guardian",
          title: "অভিভাবকের তথ্য",
          icon: "Users",
          fields: [
            { name: "fatherName", label: "পিতার নাম", type: "text", required: true },
            { name: "motherName", label: "মাতার নাম", type: "text", required: true },
            { name: "phone", label: "মোবাইল নম্বর", type: "tel", required: true, placeholder: "০১XXXX-XXXXXX" },
            { name: "email", label: "ইমেইল (যদি থাকে)", type: "email", required: false }
          ]
        },
        {
          id: "students",
          title: "শিক্ষার্থীর তথ্য",
          icon: "User",
          isRepeated: true,
          fields: [
            { name: "name", label: "শিক্ষার্থীর নাম", type: "text", required: true },
            { name: "dob", label: "জন্ম তারিখ", type: "date", required: true },
            { name: "gender", label: "লিঙ্গ", type: "select", options: [{ value: "male", label: "ছাত্র" }, { value: "female", label: "ছাত্রী" }], required: true },
            { name: "appliedClass", label: "পছন্দকৃত শ্রেণী", type: "select", options: classOptions.length > 0 ? classOptions : [{ value: "nursery", label: "নার্সারি" }], required: true }
          ]
        },
        {
          id: "address",
          title: "ঠিকানা ও অন্যান্য",
          icon: "MapPin",
          fields: [
            { name: "present", label: "বর্তমান ঠিকানা", type: "textarea", required: true },
            { name: "permanent", label: "স্থায়ী ঠিকানা", type: "textarea", required: false }
          ]
        }
      ];

      // If no settings found, return default or empty
      if (!settings) {
        settings = {
          madrasa_id: madrasa._id,
          branding: { name: madrasa.name, tagline: "", logoText: "" },
          hero: { slides: [] },
          about: { title: "", description: "", highlights: [] },
          stats: [],
          curriculum: { title: "", items: [] },
          students: { items: [] },
          teachers: { items: [] },
          gallery: { videos: [], photos: [] },
          admission_form: {
            steps: defaultSteps
          }
        };
      } else if (!settings.admission_form) {
        // Ensure admission_form exists even if settings exist
        settings.admission_form = {
          steps: defaultSteps
        };
      } else {
        // If settings.admission_form exists, we might still want to "inject" dynamic options
        // for fields that are meant to be dynamic (like appliedClass)
        settings.admission_form.steps = settings.admission_form.steps.map(step => {
          if (step.id === "students") {
            step.fields = step.fields.map(field => {
              if (field.name === "appliedClass") {
                return { ...field, options: classOptions };
              }
              return field;
            });
          }
          return step;
        });
      }

      res.status(200).json({
        success: true,
        data: {
          madrasa: {
            id: madrasa._id,
            name: madrasa.name,
            address: madrasa.address,
            slug: madrasa.slug
          },
          settings: settings
        }
      });
    } catch (error) {
      console.error("Get Portal Data Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  getAcademicData: async (req, res) => {
    const { slug } = req.params;
    const { db } = await mongoConnect();

    
    

    try {
      // 1. Find Madrasa by slug
      const madrasa = await db.collection("madrasas").findOne({ slug: slug });

     

      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      // 2. Fetch Classes and Sections for this Madrasa - handle both ObjectId and String stored madrasa_id
      const madrasaIdMatch = { $or: [{ madrasa_id: madrasa._id }, { madrasa_id: madrasa._id.toString() }] };
      const activeClasses = await db.collection("classes").find(madrasaIdMatch).toArray();
      const activeSections = await db.collection("sections").find(madrasaIdMatch).toArray();

       

      const academicData = activeClasses.map(c => ({
        id: c._id.toString(),
        name: c.name,
        sections: activeSections
          .filter(s => s.class_id.toString() === c._id.toString())
          .map(s => ({ id: s._id.toString(), name: s.name }))
      }));



      res.status(200).json({
        success: true,
        data: academicData
      });
    } catch (error) {
      console.error("Get Academic Data Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  submitOnlineAdmission: async (req, res) => {
    const { slug } = req.params;
    const payload = req.body;

    try {
      const { db } = await mongoConnect();
      // 1. Find Madrasa by slug
      const madrasa = await db.collection("madrasas").findOne({ slug: slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      // 2. Create Online Admission Entry
      const admissionData = {
        ...payload,
        madrasa_id: madrasa._id,
        status: "pending", // pending, approved, rejected
        created_at: new Date(),
        updated_at: new Date()
      };

      const result = await db.collection("online_admissions").insertOne(admissionData);

      res.status(201).json({
        success: true,
        message: "Application submitted successfully",
        data: { admissionId: result.insertedId }
      });
    } catch (error) {
      console.error("Submit Online Admission Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

module.exports = portalController;
