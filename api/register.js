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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  try {
    const { id, password } = req.body || {};
    if (!id || !password) return res.status(400).json({ error: 'ID et mot de passe requis.' });

    const db = getDb();
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (snap.exists) return res.status(409).json({ error: 'Ce compte existe déjà.' });

    const initData = {
      password,
      gems: 15000,
      inventory: [],
      currentFormation: '433',
      pitch: {},
      teamIdCounter: 0,
      pity95: 0,
      pity98: 0,
      friends: [],
      friendRequestsIncoming: [],
      friendRequestsOutgoing: [],
      lastActive: Date.now()
    };
    await ref.set(initData);

    const { password: _p, ...publicData } = initData;
    return res.status(200).json({ ...publicData, isAdmin: password === 'doliprane' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
