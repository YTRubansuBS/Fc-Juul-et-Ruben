const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.firestore();
}

function getPlayerGen(player) {
  const value = Number(player?.gen);
  return Number.isFinite(value) ? value : 0;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' });
  try {
    const db = getDb();
    const snapshot = await db.collection('users').get();
    const result = [];
    snapshot.forEach(docSnap => {
      const uData = docSnap.data() || {};
      const players = Object.values(uData.pitch || {}).filter(Boolean);
      const total = players.reduce((sum, player) => sum + getPlayerGen(player), 0);
      const ovr = players.length ? Math.round(total / players.length) : 0;
      result.push({ username: docSnap.id, ovr });
    });
    result.sort((a, b) => b.ovr - a.ovr || a.username.localeCompare(b.username));
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
