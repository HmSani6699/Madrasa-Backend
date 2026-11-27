const root = process.cwd();
const mongoConnect = require(`${root}/services/mongo-connect`);
const { ObjectId } = require("mongodb");

const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
};

const getMadrasaFilter = (madrasaId) => {
  if (!madrasaId) return null;
  const oid = toObjectId(madrasaId);
  return oid ? { $in: [oid, oid.toString()] } : madrasaId;
};

const extractYouTubeId = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/
  );
  return match ? match[1] : "";
};

const isResidentialFeeHead = (name = "", description = "") => {
  const text = `${name} ${description}`.toLowerCase();
  return /আবাসিক|বোর্ডিং|হোস্টেল|থাকা|খাওয়া|খাবার|মেস|boarding|hostel|residential|meal|food|lodging/i.test(
    text
  );
};

const isNonResidentialOnlyFeeHead = (name = "", description = "") => {
  const text = `${name} ${description}`.toLowerCase();
  return /অনাবাসিক|ডে-কেয়ার|যাতায়াত|গাড়ি|transport|non-residential|daycare/i.test(text);
};

const buildDynamicPortalPayload = async (db, madrasa) => {
  const madrasaFilter = getMadrasaFilter(madrasa._id);

  const [
    savedSettings,
    activeClasses,
    activeSections,
    allSubjects,
    recentStudents,
    totalStudentsCount,
    allStaff,
    totalParentsCount,
    adminUser,
    feeHeads,
    feeSetups,
    publishedTutorialVideos,
    boardingStudents,
  ] = await Promise.all([
    db.collection("portal_settings").findOne({ madrasa_id: madrasaFilter }),
    db.collection("classes").find({ madrasa_id: madrasaFilter, status: { $ne: "inactive" } }).sort({ name: 1 }).toArray(),
    db.collection("sections").find({ madrasa_id: madrasaFilter }).toArray(),
    db.collection("subjects").find({ madrasa_id: madrasaFilter, status: { $ne: "inactive" } }).toArray(),
    db
      .collection("students")
      .find({ madrasa_id: madrasaFilter, admissionStatus: { $ne: "Inactive" } })
      .sort({ created_at: -1 })
      .limit(24)
      .toArray(),
    db.collection("students").countDocuments({ madrasa_id: madrasaFilter, admissionStatus: { $ne: "Inactive" } }),
    db.collection("staff").find({ madrasa_id: madrasaFilter, status: { $ne: "Inactive" } }).sort({ created_at: 1 }).toArray(),
    db.collection("parents").countDocuments({ madrasa_id: madrasaFilter }),
    db.collection("users").findOne({
      madrasa_id: madrasaFilter,
      role: { $in: ["mohtamim", "admin"] },
    }),
    db.collection("fee_heads").find({ madrasa_id: madrasaFilter }).sort({ name: 1 }).toArray(),
    db.collection("fee_setups").find({ madrasa_id: madrasaFilter }).toArray(),
    db.collection("tutorial_videos").find({ isPublished: true }).sort({ order: 1 }).limit(6).toArray(),
    db.collection("boarding_students").find({ madrasa_id: madrasaFilter, status: "Active" }).limit(50).toArray(),
  ]);

  const settings = savedSettings || {};

  // Build maps for quick lookups
  const classMap = new Map();
  activeClasses.forEach((c) => classMap.set(c._id.toString(), c));

  // Count students per class across all active students
  const studentCountAgg = await db
    .collection("students")
    .aggregate([
      { $match: { madrasa_id: madrasaFilter, admissionStatus: { $ne: "Inactive" } } },
      { $group: { _id: { $toString: "$class_id" }, count: { $sum: 1 } } },
    ])
    .toArray();
  const studentCountByClass = new Map(
    studentCountAgg.map((row) => [String(row._id || ""), row.count])
  );

  // Batch fetch parents for showcased students
  const guardianIds = [
    ...new Set(recentStudents.map((s) => toObjectId(s.guardian_id)).filter(Boolean)),
  ];
  const guardianDocs = guardianIds.length
    ? await db
        .collection("parents")
        .find({ _id: { $in: guardianIds } }, { projection: { address: 1, presentAddress: 1 } })
        .toArray()
    : [];
  const guardianMap = new Map(guardianDocs.map((g) => [g._id.toString(), g]));

  // Find principal / head staff if available
  const principalStaff =
    allStaff.find((s) =>
      /principal|mohtamim|muhtamim|founder|অধ্যক্ষ|মুহতামিম|প্রতিষ্ঠাতা/i.test(
        `${s.designation || ""} ${s.role || ""}`
      )
    ) || allStaff[0] || null;

  // 1. Dynamic Stats
  const teacherList = allStaff.filter((s) =>
    /teacher|ustad|muallim|talimat|principal|mohtamim|শিক্ষক|মুহতামিম|অধ্যক্ষ/i.test(
      `${s.role || ""} ${s.designation || ""}`
    )
  );
  const teachersCount = teacherList.length > 0 ? teacherList.length : allStaff.length;

  const defaultStats = [
    {
      key: "classes",
      val: String(activeClasses.length),
      suffix: "টি",
      label: "শ্রেণি / বিভাগ",
      icon: "/portal/section.png",
    },
    {
      key: "students",
      val: String(totalStudentsCount),
      suffix: "জন",
      label: "শিক্ষার্থী",
      icon: "/portal/student.png",
    },
    {
      key: "teachers",
      val: String(teachersCount),
      suffix: "জন",
      label: "শিক্ষক",
      icon: "/portal/teacher.png",
    },
    {
      key: "guardians",
      val: String(totalParentsCount || allStaff.length),
      suffix: "জন",
      label: totalParentsCount > 0 ? "অভিভাবক" : "স্টাফ ও কর্মকর্তা",
      icon: "/portal/staff.png",
    },
  ];

  // 2. Dynamic Curriculum & Admission Fee Structure per Class
  const feeHeadMap = new Map(feeHeads.map((h) => [h._id.toString(), h]));
  const avgBoardingFee = boardingStudents.length
    ? Math.round(
        boardingStudents.reduce((sum, b) => sum + (Number(b.monthly_fee) || 0), 0) /
          boardingStudents.length
      )
    : 0;

  const customAdmissionFees = Array.isArray(settings?.admissionFees)
    ? settings.admissionFees
    : [];

  const curriculumItems = activeClasses.map((cls) => {
    const classId = cls._id.toString();

    // Subjects from subjects collection + assigned array on class/sections
    const directSubjects = allSubjects.filter(
      (sub) => String(sub.class_id || "") === classId
    );
    const assignedSubjectIds = new Set(
      (Array.isArray(cls.subjects) ? cls.subjects : []).map((id) => String(id))
    );
    activeSections
      .filter((sec) => String(sec.class_id || "") === classId)
      .forEach((sec) => {
        if (Array.isArray(sec.subjects)) {
          sec.subjects.forEach((id) => assignedSubjectIds.add(String(id)));
        }
      });

    const subjectCount = Math.max(
      directSubjects.length,
      assignedSubjectIds.size,
      Array.isArray(cls.subjects_list) ? cls.subjects_list.length : 0,
      typeof cls.subjects === "number" ? cls.subjects : 0
    );

    const studentCount = studentCountByClass.get(classId) ?? (Number(cls.students) || 0);

    return {
      id: classId,
      name: cls.name,
      subject: String(subjectCount),
      subjectCount,
      studentCount,
      level: cls.level || "",
      description: cls.description || "",
      subjectNames: directSubjects.map((s) => s.name).filter(Boolean),
    };
  });

  const admissionFees = activeClasses.map((cls) => {
    const classId = cls._id.toString();
    const currItem = curriculumItems.find((ci) => ci.id === classId);
    const customEntry = customAdmissionFees.find(
      (entry) => entry.classId === classId || entry.name === cls.name
    );

    if (customEntry && (customEntry.nonResidential || customEntry.residential)) {
      return {
        id: classId,
        name: cls.name,
        subjects: String(currItem?.subjectCount || 0),
        students: String(currItem?.studentCount || 0),
        nonResidential: customEntry.nonResidential,
        residential: customEntry.residential,
      };
    }

    const classSetups = feeSetups.filter((fs) => String(fs.class_id || "") === classId);
    const nonResItems = [];
    const resItems = [];

    classSetups.forEach((setup) => {
      const head = feeHeadMap.get(String(setup.head_id || ""));
      const label = head?.name || "ফি";
      const desc = head?.description || "";
      const amount = Number(setup.amount) || 0;

      if (isResidentialFeeHead(label, desc)) {
        resItems.push({ label, amount });
      } else if (isNonResidentialOnlyFeeHead(label, desc)) {
        nonResItems.push({ label, amount });
      } else {
        nonResItems.push({ label, amount });
        resItems.push({ label, amount });
      }
    });

    if (nonResItems.length === 0 && Number(cls.tuitionFee) > 0) {
      nonResItems.push({ label: "মাসিক বেতন", amount: Number(cls.tuitionFee) });
    }
    if (resItems.length === 0 && Number(cls.tuitionFee) > 0) {
      resItems.push({ label: "মাসিক বেতন", amount: Number(cls.tuitionFee) });
    }
    if (
      avgBoardingFee > 0 &&
      !resItems.some((item) => isResidentialFeeHead(item.label))
    ) {
      resItems.push({ label: "থাকা ও খাওয়া (বোর্ডিং)", amount: avgBoardingFee });
    }

    const sumTotal = (items) => items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);

    return {
      id: classId,
      name: cls.name,
      subjects: String(currItem?.subjectCount || 0),
      students: String(currItem?.studentCount || 0),
      nonResidential: {
        items: nonResItems,
        total: sumTotal(nonResItems),
      },
      residential: {
        items: resItems,
        total: sumTotal(resItems),
      },
    };
  });

  // 3. Dynamic Students Showcase
  const dynamicStudents = recentStudents.map((st) => {
    const cls = classMap.get(String(st.class_id || ""));
    const guardian = guardianMap.get(String(st.guardian_id || ""));
    const fullName =
      [st.firstName, st.lastName].filter(Boolean).join(" ").trim() || st.name || "শিক্ষার্থী";
    return {
      id: st._id.toString(),
      name: fullName,
      image: st.photo || "",
      address:
        guardian?.address ||
        guardian?.presentAddress ||
        st.address ||
        madrasa.address ||
        "",
      className: cls?.name || "",
      roll: st.roll_number || st.student_id || "",
    };
  });

  // 4. Dynamic Teachers / Staff Showcase
  const sortedStaff = [...allStaff].sort((a, b) => {
    const score = (doc) => {
      const text = `${doc.designation || ""} ${doc.role || ""}`.toLowerCase();
      if (/principal|mohtamim|muhtamim|founder|অধ্যক্ষ|মুহতামিম|প্রতিষ্ঠাতা/.test(text)) return 0;
      if (/teacher|ustad|muallim|শিক্ষক/.test(text)) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  const dynamicTeachers = sortedStaff.map((st) => ({
    id: st._id.toString(),
    name: st.name || "",
    role: st.designation || st.role || "শিক্ষক",
    department: st.department || "",
    qualification: st.qualification || "",
    image: st.photo || "",
    phone: st.phone || "",
    email: st.email || "",
  }));

  // 5. Dynamic Gallery Videos (saved settings -> published tutorial_videos fallback)
  const savedVideos = Array.isArray(settings?.gallery?.videos)
    ? settings.gallery.videos
        .map((v) => ({
          youtubeId: v.youtubeId || extractYouTubeId(v.videoUrl || v.embedUrl || ""),
          title: v.title || "",
        }))
        .filter((v) => v.youtubeId)
    : [];

  const dbVideos = publishedTutorialVideos
    .map((v) => ({
      youtubeId: v.youtubeId || extractYouTubeId(v.videoUrl || v.embedUrl || ""),
      title: v.title || "",
    }))
    .filter((v) => v.youtubeId);

  // 6. Admission Form Steps with live class/section options
  const classOptions = activeClasses.map((c) => ({
    value: c._id.toString(),
    label: c.name,
    sections: activeSections
      .filter((s) => String(s.class_id || "") === c._id.toString())
      .map((s) => ({ value: s._id.toString(), label: s.name })),
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
        { name: "email", label: "ইমেইল (যদি থাকে)", type: "email", required: false },
      ],
    },
    {
      id: "students",
      title: "শিক্ষার্থীর তথ্য",
      icon: "User",
      isRepeated: true,
      fields: [
        { name: "name", label: "শিক্ষার্থীর নাম", type: "text", required: true },
        { name: "dob", label: "জন্ম তারিখ", type: "date", required: true },
        {
          name: "gender",
          label: "লিঙ্গ",
          type: "select",
          options: [
            { value: "male", label: "ছাত্র" },
            { value: "female", label: "ছাত্রী" },
          ],
          required: true,
        },
        {
          name: "appliedClass",
          label: "পছন্দকৃত শ্রেণী",
          type: "select",
          options: classOptions,
          required: true,
        },
      ],
    },
    {
      id: "address",
      title: "ঠিকানা ও অন্যান্য",
      icon: "MapPin",
      fields: [
        { name: "present", label: "বর্তমান ঠিকানা", type: "textarea", required: true },
        { name: "permanent", label: "স্থায়ী ঠিকানা", type: "textarea", required: false },
      ],
    },
  ];

  let admissionForm = settings.admission_form || { steps: defaultSteps };
  if (Array.isArray(admissionForm.steps)) {
    admissionForm = {
      ...admissionForm,
      steps: admissionForm.steps.map((step) => {
        if (step.id === "students" && Array.isArray(step.fields)) {
          return {
            ...step,
            fields: step.fields.map((field) =>
              field.name === "appliedClass" ? { ...field, options: classOptions } : field
            ),
          };
        }
        return step;
      }),
    };
  }

  const resolvedAddress =
    settings?.contact?.address ||
    settings?.profile?.address ||
    madrasa.address ||
    "";
  const resolvedPhone =
    settings?.contact?.phone ||
    settings?.profile?.phone ||
    madrasa.phone ||
    adminUser?.phone ||
    principalStaff?.phone ||
    "";
  const resolvedEmail =
    settings?.contact?.email ||
    settings?.profile?.email ||
    madrasa.contact_email ||
    madrasa.email ||
    adminUser?.email ||
    principalStaff?.email ||
    "";
  const resolvedName =
    settings?.branding?.name ||
    settings?.profile?.institutionName ||
    madrasa.name ||
    "";
  const resolvedAdminName =
    settings?.profile?.adminName ||
    principalStaff?.name ||
    adminUser?.username ||
    "";

  return {
    madrasa: {
      id: madrasa._id,
      name: madrasa.name,
      address: madrasa.address || "",
      phone: resolvedPhone,
      email: resolvedEmail,
      logo: madrasa.logo || "",
      slug: madrasa.slug,
    },
    settings: {
      madrasa_id: madrasa._id,
      theme: {
        primary: settings?.theme?.primary || "#1C7D5A",
        primaryDark: settings?.theme?.primaryDark || "#123628",
        primaryLight: settings?.theme?.primaryLight || "#e8f5f0",
        secondary: settings?.theme?.secondary || "#EAB33C",
        secondaryDark: settings?.theme?.secondaryDark || "#c99327",
      },
      branding: {
        ...(settings.branding || {}),
        name: resolvedName,
        englishName: settings?.branding?.englishName || madrasa.englishName || resolvedName,
        englishLocation: settings?.branding?.englishLocation || resolvedAddress,
        arabicName: settings?.branding?.arabicName || madrasa.arabicName || "",
        arabicLocation: settings?.branding?.arabicLocation || "",
        tagline:
          settings?.branding?.tagline ||
          settings?.profile?.slogan ||
          resolvedAddress,
        logo: settings?.branding?.logo || madrasa.logo || "/portal/school.png",
        footerLogo:
          settings?.branding?.footerLogo ||
          settings?.branding?.logo ||
          madrasa.logo ||
          "/whitelogo.png",
      },
      contact: {
        ...(settings.contact || {}),
        phone: resolvedPhone,
        email: resolvedEmail,
        address: resolvedAddress,
        officeHours:
          settings?.contact?.officeHours || "শনিবার - বৃহস্পতিবার (সকাল ৮ টা থেকে বিকাল ৫ টা)",
        phoneHours: settings?.contact?.phoneHours || "ফোনে সকাল ৯টা হতে রাত ৯টা",
        mapEmbedUrl: settings?.contact?.mapEmbedUrl || "",
        social: {
          facebook: settings?.contact?.social?.facebook || "",
          twitter: settings?.contact?.social?.twitter || "",
          youtube: settings?.contact?.social?.youtube || "",
          linkedin: settings?.contact?.social?.linkedin || "",
          instagram: settings?.contact?.social?.instagram || "",
        },
      },
      profile: {
        ...(settings.profile || {}),
        institutionName: resolvedName,
        slogan: settings?.profile?.slogan || settings?.branding?.tagline || resolvedAddress,
        address: resolvedAddress,
        email: resolvedEmail,
        phone: resolvedPhone,
        adminName: resolvedAdminName,
        adminPhoto: settings?.profile?.adminPhoto || principalStaff?.photo || "",
        designation:
          settings?.profile?.designation ||
          principalStaff?.designation ||
          "মুহতামিম / অধ্যক্ষ",
      },
      hero: {
        ...(settings.hero || {}),
        leftImage: settings?.hero?.leftImage || "/portal/im1.png",
        rightImage: settings?.hero?.rightImage || "/portal/im2.png",
        badges:
          Array.isArray(settings?.hero?.badges) && settings.hero.badges.length > 0
            ? settings.hero.badges
            : ["কুরআন ও সুন্নাহ ভিত্তিক শিক্ষা", "আধুনিক ডিজিটাল ব্যবস্থাপনা"],
        slides: Array.isArray(settings?.hero?.slides) ? settings.hero.slides : [],
      },
      stats: defaultStats,
      about: {
        ...(settings.about || {}),
        badge: settings?.about?.badge || "আমাদের সম্পর্কে",
        title: settings?.about?.title || `${resolvedName} — পরিচিতি ও লক্ষ্য`,
        description:
          settings?.about?.description ||
          `${resolvedName} শিক্ষার্থীদের দ্বীনি ও আধুনিক শিক্ষার সমন্বয়ে নৈতিক, যোগ্য ও আদর্শ নাগরিক হিসেবে গড়ে তুলতে প্রতিশ্রুতিবদ্ধ।`,
        vision:
          settings?.about?.vision ||
          "কুরআন-সুন্নাহর আলোকে ও আধুনিক প্রযুক্তির সমন্বয়ে একটি আদর্শ দ্বীনি শিক্ষা প্রতিষ্ঠান হিসেবে শিক্ষার্থীদের নৈতিক ও মেধার পূর্ণ বিকাশ সাধন করা।",
        goals:
          Array.isArray(settings?.about?.goals) && settings.about.goals.length > 0
            ? settings.about.goals
            : [
                "শিক্ষার্থীদের মধ্যে নৈতিকতা, আমল-আখলাক ও নেতৃত্বের গুণাবলি বিকাশ করা।",
                "অভিজ্ঞ উস্তাদ ও আধুনিক শিক্ষাদান পদ্ধতির মাধ্যমে মানসম্মত পাঠদান নিশ্চিত করা।",
                "অভিভাবকদের সাথে নিয়মিত যোগাযোগ ও ডিজিটাল উপস্থিতি-ফলাফল সেবা প্রদান।",
                "জাতীয় ও দ্বীনি শিক্ষাবোর্ডে কৃতিত্বপূর্ণ ফলাফল অর্জন।",
              ],
        highlights:
          Array.isArray(settings?.about?.highlights) && settings.about.highlights.length > 0
            ? settings.about.highlights
            : [
                "অভিজ্ঞ উস্তাদ ও সুশৃঙ্খল পাঠদান পরিবেশ",
                "অভিভাবক ও শিক্ষার্থীবান্ধব আধুনিক ব্যবস্থাপনা",
              ],
        mainImage: settings?.about?.mainImage || "/portal/office.jpeg",
        principalImage:
          settings?.about?.principalImage ||
          principalStaff?.photo ||
          "/portal/Teacher/teacher6-2.png",
        bannerText:
          settings?.about?.bannerText ||
          `${resolvedName} একটি আদর্শ ও আধুনিক শিক্ষাপ্রতিষ্ঠান, যেখানে বর্তমানে ${activeClasses.length}টি শ্রেণিতে ${totalStudentsCount} জন শিক্ষার্থী এবং ${teachersCount} জন অভিজ্ঞ শিক্ষক-শিক্ষিকা শিক্ষা কার্যক্রমে যুক্ত রয়েছেন।`,
        introVideoUrl:
          settings?.about?.introVideoUrl ||
          (savedVideos[0]?.youtubeId
            ? `https://www.youtube.com/embed/${savedVideos[0].youtubeId}`
            : dbVideos[0]?.youtubeId
            ? `https://www.youtube.com/embed/${dbVideos[0].youtubeId}`
            : ""),
        founder: {
          name: settings?.about?.founder?.name || resolvedAdminName || resolvedName,
          designation:
            settings?.about?.founder?.designation ||
            principalStaff?.designation ||
            "প্রতিষ্ঠাতা ও মুহতামিম",
          bio:
            settings?.about?.founder?.bio ||
            `${resolvedName}-এর পরিচালনায় নৈতিকতা ও আধুনিক শিক্ষার সমন্বয়ে শিক্ষার্থীদের যোগ্য নাগরিক হিসেবে গড়ে তোলা হচ্ছে।`,
          image:
            settings?.about?.founder?.image ||
            settings?.about?.principalImage ||
            principalStaff?.photo ||
            "/portal/bgre.jpg",
        },
      },
      curriculum: {
        ...(settings.curriculum || {}),
        badge: settings?.curriculum?.badge || "ক্লাস পাঠ্যক্রম",
        title: settings?.curriculum?.title || "শ্রেণি ও পাঠ্যক্রম পরিচিতি",
        items:
          curriculumItems.length > 0
            ? curriculumItems
            : Array.isArray(settings?.curriculum?.items)
            ? settings.curriculum.items
            : [],
      },
      students: {
        ...(settings.students || {}),
        badge: settings?.students?.badge || "আমাদের শিক্ষার্থী",
        title: settings?.students?.title || "আমাদের শিক্ষার্থী বৃন্দ",
        items:
          dynamicStudents.length > 0
            ? dynamicStudents
            : Array.isArray(settings?.students?.items)
            ? settings.students.items
            : [],
      },
      teachers: {
        ...(settings.teachers || {}),
        badge: settings?.teachers?.badge || "আমাদের শিক্ষক",
        title: settings?.teachers?.title || "আমাদের সম্মানিত শিক্ষক বৃন্দ",
        items:
          dynamicTeachers.length > 0
            ? dynamicTeachers.slice(0, 6)
            : Array.isArray(settings?.teachers?.items)
            ? settings.teachers.items
            : [],
        all:
          dynamicTeachers.length > 0
            ? dynamicTeachers
            : Array.isArray(settings?.teachers?.items)
            ? settings.teachers.items
            : [],
      },
      admissionFees:
        admissionFees.length > 0 ? admissionFees : customAdmissionFees,
      gallery: {
        ...(settings.gallery || {}),
        videoBadge: settings?.gallery?.videoBadge || "ভিডিও গ্যালারি",
        videoTitle:
          settings?.gallery?.videoTitle || `${resolvedName} — ভিডিও গ্যালারি`,
        videos: savedVideos.length > 0 ? savedVideos : dbVideos,
        photoBadge: settings?.gallery?.photoBadge || "ছবি গ্যালারি",
        photoTitle:
          settings?.gallery?.photoTitle || `${resolvedName}-এর ছবি গ্যালারি`,
        photos:
          Array.isArray(settings?.gallery?.photos) && settings.gallery.photos.length > 0
            ? settings.gallery.photos
            : [
                "/portal/gallery/img8.jpg",
                "/portal/gallery/img1.jpg",
                "/portal/gallery/img2.jpeg",
                "/portal/gallery/img7.jpeg",
                "/portal/gallery/img3.jpeg",
                "/portal/gallery/img4.jpeg",
                "/portal/gallery/img5.jpeg",
                "/portal/gallery/img6.jpeg",
              ],
      },
      footer: {
        ...(settings.footer || {}),
        aboutText:
          settings?.footer?.aboutText ||
          `${resolvedName} — কুরআন ও সুন্নাহর আলোকে আধুনিক শিক্ষা ও নৈতিক চরিত্র গঠনের নির্ভরযোগ্য প্রতিষ্ঠান।`,
        copyright:
          settings?.footer?.copyright ||
          `© ${new Date().getFullYear()} ${resolvedName}. সর্বস্বত্ব সংরক্ষিত।`,
      },
      admission_form: admissionForm,
    },
  };
};

const portalController = {
  getPortalData: async (req, res) => {
    const { slug } = req.params;
    const { db } = await mongoConnect();

    try {
      const madrasa = await db.collection("madrasas").findOne({ slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const payload = await buildDynamicPortalPayload(db, madrasa);

      res.status(200).json({
        success: true,
        data: payload,
      });
    } catch (error) {
      console.error("Get Portal Data Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  getManagedPortalSettings: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      const madrasaId = toObjectId(req.user?.madrasa_id);
      if (!madrasaId) {
        return res.status(400).json({ success: false, message: "Madrasa ID is required" });
      }

      const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const payload = await buildDynamicPortalPayload(db, madrasa);
      res.status(200).json({ success: true, data: payload });
    } catch (error) {
      console.error("Get Managed Portal Settings Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  updateManagedPortalSettings: async (req, res) => {
    try {
      const { db } = await mongoConnect();
      const madrasaId = toObjectId(req.user?.madrasa_id);
      if (!madrasaId) {
        return res.status(400).json({ success: false, message: "Madrasa ID is required" });
      }

      const madrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const incoming = req.body || {};
      // Strip derived/immutable fields before storing
      const { _id, madrasa_id: _mid, madrasa: _m, ...cleanSettings } = incoming;

      await db.collection("portal_settings").updateOne(
        { madrasa_id: madrasaId },
        {
          $set: {
            ...cleanSettings,
            madrasa_id: madrasaId,
            updated_at: new Date(),
          },
          $setOnInsert: {
            created_at: new Date(),
          },
        },
        { upsert: true }
      );

      // Keep madrasa basic profile synced when updated from settings/profile
      const madrasaUpdates = {};
      const nextName =
        cleanSettings?.profile?.institutionName || cleanSettings?.branding?.name;
      const nextAddress =
        cleanSettings?.profile?.address || cleanSettings?.contact?.address;
      const nextPhone =
        cleanSettings?.profile?.phone || cleanSettings?.contact?.phone;
      const nextEmail =
        cleanSettings?.profile?.email || cleanSettings?.contact?.email;
      const nextLogo = cleanSettings?.branding?.logo;

      if (nextName && nextName.trim()) madrasaUpdates.name = nextName.trim();
      if (nextAddress !== undefined) madrasaUpdates.address = nextAddress;
      if (nextPhone !== undefined) madrasaUpdates.phone = nextPhone;
      if (nextEmail !== undefined) madrasaUpdates.contact_email = nextEmail;
      if (nextLogo && !nextLogo.startsWith("/portal/")) madrasaUpdates.logo = nextLogo;

      if (Object.keys(madrasaUpdates).length > 0) {
        madrasaUpdates.updated_at = new Date();
        await db.collection("madrasas").updateOne({ _id: madrasaId }, { $set: madrasaUpdates });
      }

      const refreshedMadrasa = await db.collection("madrasas").findOne({ _id: madrasaId });
      const payload = await buildDynamicPortalPayload(db, refreshedMadrasa);

      res.status(200).json({
        success: true,
        message: "Portal settings updated successfully",
        data: payload,
      });
    } catch (error) {
      console.error("Update Managed Portal Settings Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  getAcademicData: async (req, res) => {
    const { slug } = req.params;
    const { db } = await mongoConnect();

    try {
      const madrasa = await db.collection("madrasas").findOne({ slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const madrasaIdMatch = { madrasa_id: getMadrasaFilter(madrasa._id) };
      const activeClasses = await db.collection("classes").find(madrasaIdMatch).toArray();
      const activeSections = await db.collection("sections").find(madrasaIdMatch).toArray();

      const academicData = activeClasses.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        sections: activeSections
          .filter((s) => String(s.class_id || "") === c._id.toString())
          .map((s) => ({ id: s._id.toString(), name: s.name })),
      }));

      res.status(200).json({
        success: true,
        data: academicData,
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
      const madrasa = await db.collection("madrasas").findOne({ slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const admissionData = {
        ...payload,
        madrasa_id: madrasa._id,
        status: "pending",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await db.collection("online_admissions").insertOne(admissionData);

      res.status(201).json({
        success: true,
        message: "Application submitted successfully",
        data: { admissionId: result.insertedId },
      });
    } catch (error) {
      console.error("Submit Online Admission Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  },

  submitPortalContact: async (req, res) => {
    const { slug } = req.params;
    const { name, number, phone, email, description, message } = req.body || {};

    try {
      const cleanName = (name || "").trim();
      const cleanPhone = (phone || number || "").trim();
      const cleanMessage = (message || description || "").trim();

      if (!cleanName || !cleanPhone || !cleanMessage) {
        return res.status(400).json({
          success: false,
          message: "অনুগ্রহ করে নাম, মোবাইল নম্বর এবং বার্তা সঠিকভাবে পূরণ করুন।",
        });
      }

      const { db } = await mongoConnect();
      const madrasa = await db.collection("madrasas").findOne({ slug });
      if (!madrasa) {
        return res.status(404).json({ success: false, message: "Madrasa not found" });
      }

      const doc = {
        madrasa_id: madrasa._id,
        madrasa_slug: madrasa.slug,
        madrasa_name: madrasa.name,
        source: "portal",
        name: cleanName,
        phone: cleanPhone,
        email: (email || "").trim(),
        message: cleanMessage,
        status: "unread",
        adminNotes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection("contact_messages").insertOne(doc);

      res.status(201).json({
        success: true,
        message: "আপনার বার্তা সফলভাবে পাঠানো হয়েছে! আমরা শীঘ্রই যোগাযোগ করব।",
        data: { id: result.insertedId },
      });
    } catch (error) {
      console.error("Submit Portal Contact Error:", error);
      res.status(500).json({
        success: false,
        message: "বার্তা পাঠাতে সমস্যা হয়েছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।",
      });
    }
  },
};

module.exports = portalController;
