const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const { MongoClient } = require('mongodb');
const getMongoConnection = require('./services/mongo-connect');

async function test() {
  const { db, client } = await getMongoConnection();
  
  const req = {
     query: { view: 'teacher', teacher_id: '6999de13b1b20421349c8026' },
     user: { madrasa_id: '6999aeab61186e953421b2e1' }
  };
  
  const filters = {};
  const safeObjectId = (id) => {
    if (!id) return id;
    if (typeof id !== 'string') return id;
    return /^[0-9a-fA-F]{24}$/.test(id) ? new (require('mongodb').ObjectId)(id) : id;
  };
  
  const mId = req.user.madrasa_id;
  filters.madrasa_id = { $in: [mId, safeObjectId(mId)].filter(Boolean) };

  const { teacher_id, view } = req.query;
  const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
  const combinedTeacherIds = [];
  teacherIds.forEach(id => {
      combinedTeacherIds.push(id.toString());
      const oId = safeObjectId(id);
      if (oId && oId.toString() !== id.toString()) combinedTeacherIds.push(oId);
      else if (oId) combinedTeacherIds.push(oId);
  });
  filters['periods.teacher_id'] = { $in: combinedTeacherIds };
  
  console.log('Filters:', JSON.stringify(filters, null, 2));

  let routines = await db.collection('class_routines').find(filters).toArray();
  console.log('Routines found:', routines.length);
  
  let resultData = [];
  const stringTeacherIds = teacherIds.map(id => id.toString());
  
  for (let routine of routines) {
     for (let period of routine.periods) {
         const pTeacherId = period.teacher_id ? period.teacher_id.toString() : null;
         if (stringTeacherIds.length > 0 && !stringTeacherIds.includes(pTeacherId)) continue;
         resultData.push({ ...period, _id: routine._id, day: routine.day });
     }
  }
  
  console.log('Result Data length:', resultData.length);
  console.log(resultData);
  
  await client.close();
}
test().catch(console.error);
