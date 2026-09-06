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
    const { id, password, gems, inventory, currentFormation, pitch, teamIdCounter, friends } = req.body || {};
    if (!id || !password) return res.status(400).json({ error: 'ID et mot de passe requis.' });

    const db = getDb();
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().password !== password) {
      return res.status(401).json({ error: 'Authentification invalide.' });
    }

    await ref.set({
      password,
      gems: gems || 0,
      inventory: inventory || [],
      currentFormation: currentFormation || '433',
      pitch: pitch || {},
      teamIdCounter: teamIdCounter || 0,
      friends: friends || []
    }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
