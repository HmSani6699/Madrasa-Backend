const mongoConnect = require("./services/mongo-connect");
const mongo = require("./services/mongo-crud");

async function test() {
  const { db, client } = await mongoConnect();
  try {
    const list = await mongo.fetchWithAggregation(db, "academic_reports", [{ $match: {} }]);
    console.log("Success:", list.length);
  } catch(e) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
test();
