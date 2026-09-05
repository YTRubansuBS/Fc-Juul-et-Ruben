const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  }
  return admin.firestore();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' });
  try {
    const db = getDb();
    const snapshot = await db.collection('users').get();
    const result = [];
    snapshot.forEach(docSnap => {
      const uData = docSnap.data();
      let ovr = 0;
      if (uData && uData.pitch) {
        let tot = 0, c = 0;
        Object.values(uData.pitch).forEach(p => { if (p) { tot += p.gen; c++; } });
        const slotsLen = Object.keys(uData.pitch).length;
        ovr = c === 0 ? 0 : Math.round((tot / c) * (c / slotsLen));
      }
      result.push({ username: docSnap.id, ovr });
    });
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
