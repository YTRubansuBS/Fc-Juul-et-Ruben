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

    const [userSnap, matchSnap, tradeSnap] = await Promise.all([
      db.collection('users').doc(id).get(),
      db.collection('matches').where('players', 'array-contains', id).get(),
      db.collection('trades').where('users', 'array-contains', id).get()
    ]);

    if (!userSnap.exists) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const userData = userSnap.data();

    const pendingMatches = [];
    matchSnap.forEach(d => {
      const data = d.data();
      if (data.status === 'pending' && data.players[1] === id) pendingMatches.push({ id: d.id, from: data.players[0] });
    });

    const pendingTrades = [];
    tradeSnap.forEach(d => {
      const data = d.data();
      if (data.status === 'pending_accept' && data.users[1] === id) pendingTrades.push({ id: d.id, from: data.users[0] });
    });

    return res.status(200).json({
      incoming: userData.friendRequestsIncoming || [],
      friends: userData.friends || [],
      pendingMatches,
      pendingTrades
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
