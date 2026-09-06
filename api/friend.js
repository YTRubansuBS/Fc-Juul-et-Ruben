const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  }
  return admin.firestore();
}

async function checkAuth(db, id, password) {
  const ref = db.collection('users').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data().password !== password) return null;
  return { ref, data: snap.data() };
}

module.exports = async (req, res) => {
  try {
    const db = getDb();

    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requis.' });
      const snap = await db.collection('users').doc(id).get();
      if (!snap.exists) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      const data = snap.data();
      return res.status(200).json({
        incoming: data.friendRequestsIncoming || [],
        outgoing: data.friendRequestsOutgoing || [],
        friends: data.friends || []
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
    const { action, id, password, target, accept } = req.body || {};
    if (!action || !id || !password || !target) return res.status(400).json({ error: 'Paramètres manquants.' });

    const me = await checkAuth(db, id, password);
    if (!me) return res.status(401).json({ error: 'Authentification invalide.' });

    const targetRef = db.collection('users').doc(target);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) return res.status(404).json({ error: "Cet utilisateur n'existe pas." });
    const targetData = targetSnap.data();

    if (action === 'request') {
      if (target === id) return res.status(400).json({ error: 'Impossible de vous ajouter vous-même.' });
      const myFriends = me.data.friends || [];
      if (myFriends.includes(target)) return res.status(409).json({ error: 'Vous êtes déjà amis.' });
      const myOutgoing = me.data.friendRequestsOutgoing || [];
      if (myOutgoing.includes(target)) return res.status(409).json({ error: 'Demande déjà envoyée.' });

      const myIncoming = me.data.friendRequestsIncoming || [];
      if (myIncoming.includes(target)) {
        // L'autre nous avait déjà envoyé une demande : on accepte directement
        await me.ref.update({
          friendRequestsIncoming: myIncoming.filter(u => u !== target),
          friends: admin.firestore.FieldValue.arrayUnion(target)
        });
        const targetOutgoing = targetData.friendRequestsOutgoing || [];
        await targetRef.update({
          friendRequestsOutgoing: targetOutgoing.filter(u => u !== id),
          friends: admin.firestore.FieldValue.arrayUnion(id)
        });
        return res.status(200).json({ status: 'accepted' });
      }

      await me.ref.update({ friendRequestsOutgoing: admin.firestore.FieldValue.arrayUnion(target) });
      await targetRef.update({ friendRequestsIncoming: admin.firestore.FieldValue.arrayUnion(id) });
      return res.status(200).json({ status: 'sent' });
    }

    if (action === 'respond') {
      const myIncoming = me.data.friendRequestsIncoming || [];
      if (!myIncoming.includes(target)) return res.status(409).json({ error: 'Aucune demande de cet utilisateur.' });

      await me.ref.update({ friendRequestsIncoming: myIncoming.filter(u => u !== target) });
      const targetOutgoing = targetData.friendRequestsOutgoing || [];
      await targetRef.update({ friendRequestsOutgoing: targetOutgoing.filter(u => u !== id) });

      if (accept) {
        await me.ref.update({ friends: admin.firestore.FieldValue.arrayUnion(target) });
        await targetRef.update({ friends: admin.firestore.FieldValue.arrayUnion(id) });
      }
      return res.status(200).json({ status: accept ? 'accepted' : 'declined' });
    }

    if (action === 'remove') {
      await me.ref.update({ friends: admin.firestore.FieldValue.arrayRemove(target) });
      await targetRef.update({ friends: admin.firestore.FieldValue.arrayRemove(id) });
      return res.status(200).json({ status: 'removed' });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erreur serveur.' });
  }
};
