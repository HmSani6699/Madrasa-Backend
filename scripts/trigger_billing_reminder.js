const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGO_DB_URI || "mongodb://127.0.0.1:27017/talimsoft";

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("talimsoft");
    const collection = db.collection("madrasas");

    const args = process.argv.slice(2);
    const action = args[0]; // 'reminder', 'suspend', 'activate', 'list'
    const targetSlug = args[1];

    if (!action || action === 'list') {
      console.log("\n==========================================");
      console.log("MMS SUBSCRIPTION & BILLING DEVELOPER UTILITY");
      console.log("==========================================");
      console.log("Available Madrasas in database:");
      const madrasas = await collection.find().toArray();
      if (madrasas.length === 0) {
        console.log("No madrasas found in the database.");
      } else {
        madrasas.forEach(m => {
          const daysLeft = m.subscription?.nextBillingDate
            ? Math.ceil((new Date(m.subscription.nextBillingDate) - new Date()) / (1000 * 60 * 60 * 24))
            : 'N/A';
          console.log(`- Slug: "${m.slug}" | Name: "${m.name}" | Status: ${m.status} | Days Left: ${daysLeft} | Billing Date: ${m.subscription?.nextBillingDate || 'N/A'}`);
        });
      }

      console.log("\nUsage:");
      console.log("  node scripts/trigger_billing_reminder.js reminder <slug>  - Set subscription expiring in 3 days (shows orange warning banner)");
      console.log("  node scripts/trigger_billing_reminder.js suspend <slug>   - Suspend subscription (triggers 403 Access Block)");
      console.log("  node scripts/trigger_billing_reminder.js activate <slug>  - Reactivate subscription with 30 days validity");
      return;
    }

    if (!targetSlug) {
      console.error("❌ Error: Please specify a madrasa slug as the second argument.");
      return;
    }

    const madrasa = await collection.findOne({ slug: targetSlug });
    if (!madrasa) {
      console.error(`❌ Error: Madrasa with slug "${targetSlug}" not found.`);
      return;
    }

    if (action === 'reminder') {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      threeDaysFromNow.setHours(12, 0, 0, 0);

      await collection.updateOne(
        { _id: madrasa._id },
        {
          $set: {
            status: "Active",
            "subscription.status": "active",
            "subscription.nextBillingDate": threeDaysFromNow,
            updated_at: new Date()
          }
        }
      );
      console.log(`\n✔ SUCCESS! "${madrasa.name}" has been updated.`);
      console.log(`  - Status: Active`);
      console.log(`  - Next Billing Date: ${threeDaysFromNow.toDateString()} (Expiring in 3 days)`);
      console.log(`👉 Refresh the Admin Dashboard page in your browser. You should now see the orange warning banner!`);

    } else if (action === 'suspend') {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 2);

      await collection.updateOne(
        { _id: madrasa._id },
        {
          $set: {
            status: "Suspended",
            "subscription.status": "suspended",
            "subscription.nextBillingDate": expiredDate,
            updated_at: new Date()
          }
        }
      );
      console.log(`\n✔ SUCCESS! "${madrasa.name}" has been updated.`);
      console.log(`  - Status: Suspended`);
      console.log(`  - Next Billing Date: ${expiredDate.toDateString()} (Expired 2 days ago)`);
      console.log(`👉 Try accessing any Admin API or page. The request will be blocked with a 403 status!`);

    } else if (action === 'activate') {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      await collection.updateOne(
        { _id: madrasa._id },
        {
          $set: {
            status: "Active",
            "subscription.status": "active",
            "subscription.nextBillingDate": thirtyDaysFromNow,
            updated_at: new Date()
          }
        }
      );
      console.log(`\n✔ SUCCESS! "${madrasa.name}" has been reactivated.`);
      console.log(`  - Status: Active`);
      console.log(`  - Next Billing Date: ${thirtyDaysFromNow.toDateString()} (30 days remaining)`);
      console.log(`👉 All subscription checks are clean and normal now.`);
    } else {
      console.log("❌ Error: Invalid action. Use 'reminder', 'suspend', or 'activate'.");
    }

  } catch (err) {
    console.error("Database operation failed:", err);
  } finally {
    await client.close();
  }
}

run();
