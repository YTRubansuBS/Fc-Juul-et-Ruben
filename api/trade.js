const admin = require('firebase-admin');
function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin.firestore();
}
const ONLINE_WINDOW_MS = 45000;
const COUNTDOWN_MS = 5000;
async function checkAuth(db, id, password) {
  const ref = db.collection('users').doc(id); const snap = await ref.get();
  if (!snap.exists || snap.data().password !== password) return null;
  return { ref, data: snap.data() };
}
function emptyOffer() { return { cards: [], gems: 0, ready: false, confirmed: false }; }

module.exports = async (req, res) => {
  try {
    const db = getDb();
    if (req.method === 'GET') {
      const { tradeId, action, id } = req.query;
      if (action === 'pending') {
        if (!id) return res.status(400).json({ error: 'ID requis.' });
        const snap = await db.collection('trades').where('users', 'array-contains', id).get();
        const list = [];
        snap.forEach(d => { const t = d.data(); if (t.status === 'pending' && t.target === id) list.push({ id: d.id, from: t.creator, status: t.status }); });
        return res.status(200).json(list);
      }
      if (!tradeId) return res.status(400).json({ error: 'tradeId requis.' });
      const snap = await db.collection('trades').doc(tradeId).get();
      if (!snap.exists) return res.status(404).json({ error: 'Échange introuvable.' });
      return res.status(200).json({ id: snap.id, ...snap.data() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
    const body = req.body || {}; const { action, id, password } = body;
    if (!action || !id || !password) return res.status(400).json({ error: 'Paramètres manquants.' });
    const me = await checkAuth(db, id, password);
    if (!me) return res.status(401).json({ error: 'Authentification invalide.' });

    if (action === 'create') {
      const { target } = body;
      if (!target) return res.status(400).json({ error: 'Cible manquante.' });
      if (!(me.data.friends || []).includes(target)) return res.status(403).json({ error: "Vous n'êtes pas amis avec cet utilisateur." });
      const targetSnap = await db.collection('users').doc(target).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Cet utilisateur n'existe pas." });
      if (Date.now() - (targetSnap.data().lastActive || 0) > ONLINE_WINDOW_MS) return res.status(409).json({ error: "Cet ami n'est pas connecté actuellement." });
      const tradeRef = db.collection('trades').doc();
      const tradeData = { users: [id, target], creator: id, target, offers: { [id]: emptyOffer(), [target]: emptyOffer() }, messages: [], status: 'pending', countdownEndsAt: null, createdAt: Date.now() };
      await tradeRef.set(tradeData);
      return res.status(200).json({ id: tradeRef.id, ...tradeData });
    }

    const { tradeId } = body;
    if (!tradeId) return res.status(400).json({ error: 'tradeId requis.' });
    const tradeRef = db.collection('trades').doc(tradeId);

    if (action === 'respond') {
      const { accept } = body;
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.');
        const trade = snap.data();
        if (trade.target !== id || trade.status !== 'pending') throw new Error("Cette invitation n'est plus valide.");
        trade.status = accept ? 'active' : 'declined'; trade.respondedAt = Date.now();
        tx.set(tradeRef, trade); return trade;
      });
      return res.status(200).json({ id: tradeId, ...result });
    }

    if (action === 'offer') {
      const { cards, gems } = body;
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.');
        const trade = snap.data(); if (!trade.users.includes(id) || trade.status !== 'active') throw new Error("L'échange doit d'abord être accepté.");
        const other = trade.users.find(u => u !== id);
        trade.offers[id] = { cards: cards || [], gems: Math.max(0, Number(gems) || 0), ready: false, confirmed: false };
        trade.offers[other].ready = false; trade.offers[other].confirmed = false;
        tx.set(tradeRef, trade); return trade;
      });
      return res.status(200).json({ id: tradeId, ...result });
    }
    if (action === 'message') {
      const { text } = body; if (!text || !text.trim()) return res.status(400).json({ error: 'Message vide.' });
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.'); const trade = snap.data();
        if (!trade.users.includes(id) || trade.status !== 'active') throw new Error("L'échange doit être accepté.");
        trade.messages = [...(trade.messages || []), { from: id, text: text.trim().slice(0, 200), ts: Date.now() }].slice(-50);
        tx.set(tradeRef, trade); return trade;
      }); return res.status(200).json({ id: tradeId, ...result });
    }
    if (action === 'ready') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.'); const trade = snap.data();
        if (!trade.users.includes(id) || trade.status !== 'active') throw new Error("L'échange n'est pas actif.");
        trade.offers[id].ready = !!body.ready; if (!body.ready) trade.offers[id].confirmed = false;
        tx.set(tradeRef, trade); return trade;
      }); return res.status(200).json({ id: tradeId, ...result });
    }
    if (action === 'confirm') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.'); const trade = snap.data();
        if (!trade.users.includes(id) || trade.status !== 'active') throw new Error("L'échange n'est pas actif.");
        const other = trade.users.find(u => u !== id);
        if (!trade.offers[id].ready || !trade.offers[other].ready) throw new Error('Les deux joueurs doivent valider avant de confirmer.');
        trade.offers[id].confirmed = true;
        if (trade.offers[other].confirmed) { trade.status = 'countdown'; trade.countdownEndsAt = Date.now() + COUNTDOWN_MS; }
        tx.set(tradeRef, trade); return trade;
      }); return res.status(200).json({ id: tradeId, ...result });
    }
    if (action === 'cancel') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.'); const trade = snap.data();
        if (!trade.users.includes(id) || trade.status === 'completed') throw new Error("Impossible d'annuler cet échange.");
        trade.status = 'cancelled'; trade.countdownEndsAt = null; tx.set(tradeRef, trade); return trade;
      }); return res.status(200).json({ id: tradeId, ...result });
    }
    if (action === 'finalize') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(tradeRef); if (!snap.exists) throw new Error('Échange introuvable.'); const trade = snap.data();
        if (trade.status === 'completed') return trade;
        if (trade.status !== 'countdown' || Date.now() < trade.countdownEndsAt) throw new Error("L'échange n'est pas prêt.");
        const [userA, userB] = trade.users, refA = db.collection('users').doc(userA), refB = db.collection('users').doc(userB);
        const snapA = await tx.get(refA), snapB = await tx.get(refB); if (!snapA.exists || !snapB.exists) throw new Error('Utilisateur introuvable.');
        const dataA = snapA.data(), dataB = snapB.data(), offerA = trade.offers[userA], offerB = trade.offers[userB];
        const removeCards = (inv, pitch, ids) => {
          const removedCards = [], newInv = [];
          (inv || []).forEach(c => ids.includes(c.uniqueId) ? removedCards.push(c) : newInv.push(c));
          const newPitch = { ...(pitch || {}) }; Object.keys(newPitch).forEach(k => { if (newPitch[k] && ids.includes(newPitch[k].uniqueId)) newPitch[k] = null; });
          return { removedCards, newInv, newPitch };
        };
        const resA = removeCards(dataA.inventory, dataA.pitch, (offerA.cards || []).map(c => c.uniqueId));
        const resB = removeCards(dataB.inventory, dataB.pitch, (offerB.cards || []).map(c => c.uniqueId));
        let counter = Math.max(dataA.teamIdCounter || 0, dataB.teamIdCounter || 0) + 1;
        const receivedByA = resB.removedCards.map(c => ({ ...c, uniqueId: counter++ })); const receivedByB = resA.removedCards.map(c => ({ ...c, uniqueId: counter++ }));
        const gemsA = (dataA.gems || 0) - (offerA.gems || 0) + (offerB.gems || 0); const gemsB = (dataB.gems || 0) - (offerB.gems || 0) + (offerA.gems || 0);
        tx.update(refA, { inventory: [...resA.newInv, ...receivedByA], pitch: resA.newPitch, gems: Math.max(0, gemsA), teamIdCounter: counter });
        tx.update(refB, { inventory: [...resB.newInv, ...receivedByB], pitch: resB.newPitch, gems: Math.max(0, gemsB), teamIdCounter: counter });
        trade.status = 'completed'; tx.set(tradeRef, trade); return trade;
      }); return res.status(200).json({ id: tradeId, ...result });
    }
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) { console.error(e); return res.status(400).json({ error: e.message || 'Erreur serveur.' }); }
};
