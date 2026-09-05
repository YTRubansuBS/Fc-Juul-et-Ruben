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
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requis.' });

    const db = getDb();
    const snap = await db.collection('users').doc(id).get();
    if (!snap.exists) return res.status(200).json({ exists: false });

    const uData = snap.data();
    let ovr = 0;
    if (uData && uData.pitch) {
      let tot = 0, c = 0;
      Object.values(uData.pitch).forEach(p => { if (p) { tot += p.gen; c++; } });
      const slotsLen = Object.keys(uData.pitch).length;
      ovr = c === 0 ? 0 : Math.round((tot / c) * (c / slotsLen));
    }
    return res.status(200).json({ exists: true, ovr });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
