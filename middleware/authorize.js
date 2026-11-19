const root = process.cwd();

const mongo = require(`${root}/services/mongo-crud`);
const mongoConnect = require(`${root}/services/mongo-connect`);

const authorize = async (req, res, next) => {
    const { db, client } = await mongoConnect();
    const { email, userId } = req.headers.user;
    try {
        const user = await mongo.fetchOne(db, 'person', { email, userId });
        if (!user) {
            await client.close();
            return res.status(403).send({ error: "Not Authorized", message: 'You are not authorized!' });
        };
        const { type, username, orgId } = user;
        const isOrgMember = type === 'org_member';
        const isClient = type === 'client';
        const isOrgAdmin = type === 'org_admin';
        const isSuperAdmin = type === 'super_admin';
        const isOrgEditor = type === 'org_editor';
        req.headers.person = {
            isOrgMember,
            isClient,
            isOrgAdmin,
            isSuperAdmin,
            userId,
            email,
            username,
            orgId,
            isOrgEditor
        }
        next();
    } catch (err) {
        res.status(403).json({ error: "Not Authorized", message: err.message })
    } finally {
        await client.close();
    }
}
module.exports = authorize;