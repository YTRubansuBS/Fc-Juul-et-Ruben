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
    const { id, password } = req.query;
    if (!id || !password) return res.status(400).json({ error: 'ID et mot de passe requis.' });

    const db = getDb();
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().password !== password) {
      return res.status(401).json({ error: 'Authentification invalide.' });
    }

    const { password: _p, ...publicData } = snap.data();
    return res.status(200).json(publicData);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
