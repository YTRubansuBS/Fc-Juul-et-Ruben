const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin.firestore();
}

const ONLINE_WINDOW_MS = 45000;
const baseCommentaries = [
  "Grosse accélération sur l'aile, le défenseur est pris de vitesse !",
  "Frappe lourde de loin qui flirte avec la lucarne !",
  "Intervention défensive propre et autoritaire.",
  "Ouverture dans la profondeur, l'attaquant file au but...",
  "Parade réflexe du gardien sur cette tête à bout portant !",
  "Le jeu s'installe dans le camp adverse, la pression monte.",
  "Faute au milieu de terrain, l'arbitre siffle.",
  "Séquence de passes qui met la défense dans le vent !",
  "Contre-attaque fulgurante d'un camp à l'autre !",
  "Le bloc défensif tient bon face aux assauts adverses."
];
function randomComment() { return baseCommentaries[Math.floor(Math.random() * baseCommentaries.length)]; }
async function checkAuth(db, id, password) {
  const ref = db.collection('users').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data().password !== password) return null;
  return { ref, data: snap.data() };
}
function validBet(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

module.exports = async (req, res) => {
  try {
    const db = getDb();
    if (req.method === 'GET') {
      const { action, id, matchId } = req.query;
      if (action === 'pending') {
        if (!id) return res.status(400).json({ error: 'ID requis.' });
        const snap = await db.collection('matches').where('players', 'array-contains', id).get();
        const list = [];
        snap.forEach(d => {
          const data = d.data();
          if (['pending', 'betting'].includes(data.status) && data.players[1] === id) list.push({ id: d.id, from: data.players[0], status: data.status, bet: data.bet || null });
        });
        return res.status(200).json(list);
      }
      if (!matchId) return res.status(400).json({ error: 'matchId requis.' });
      const snap = await db.collection('matches').doc(matchId).get();
      if (!snap.exists) return res.status(404).json({ error: 'Match introuvable.' });
      return res.status(200).json({ id: snap.id, ...snap.data() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
    const body = req.body || {};
    const { action, id, password } = body;
    if (!action || !id || !password) return res.status(400).json({ error: 'Paramètres manquants.' });
    const me = await checkAuth(db, id, password);
    if (!me) return res.status(401).json({ error: 'Authentification invalide.' });

    if (action === 'invite') {
      const { target, myOvr } = body;
      if (!target) return res.status(400).json({ error: 'Cible manquante.' });
      if (!(me.data.friends || []).includes(target)) return res.status(403).json({ error: "Vous n'êtes pas amis avec cet utilisateur." });
      const targetSnap = await db.collection('users').doc(target).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Cet utilisateur n'existe pas." });
      if (Date.now() - (targetSnap.data().lastActive || 0) > ONLINE_WINDOW_MS) return res.status(409).json({ error: "Cet ami n'est pas connecté actuellement." });
      const matchRef = db.collection('matches').doc();
      const matchData = {
        players: [id, target],
        teamNames: { [id]: `Équipe de ${id}`, [target]: `Équipe de ${target}` },
        hostOvr: Math.round(myOvr) || 70, guestOvr: 0,
        status: 'pending', time: 0, homeScore: 0, awayScore: 0, events: [],
        bet: { mode: 'waiting', amount: 0, selections: { [id]: null, [target]: null }, locked: false },
        createdAt: Date.now(), finishedAt: null
      };
      await matchRef.set(matchData);
      return res.status(200).json({ id: matchRef.id, ...matchData });
    }

    const { matchId } = body;
    if (!matchId) return res.status(400).json({ error: 'matchId requis.' });
    const matchRef = db.collection('matches').doc(matchId);

    if (action === 'respond') {
      const { accept, myOvr } = body;
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (match.players[1] !== id || match.status !== 'pending') throw new Error("Cette invitation n'est plus valide.");
        if (!accept) match.status = 'declined';
        else { match.status = 'betting'; match.guestOvr = Math.round(myOvr) || 70; }
        tx.set(matchRef, match); return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    if (action === 'bet') {
      const { mode, amount } = body;
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (!match.players.includes(id) || match.status !== 'betting') throw new Error('Les paris ne sont pas disponibles.');
        match.bet = match.bet || { selections: {} };
        if (mode === 'none') match.bet.selections[id] = { mode: 'none', amount: 0 };
        else {
          const bet = validBet(amount);
          if (bet <= 0) throw new Error('Choisis un nombre de gemmes valide ou ne rien parier.');
          match.bet.selections[id] = { mode: 'bet', amount: bet };
        }
        const a = match.bet.selections[match.players[0]], b = match.bet.selections[match.players[1]];
        if (a && b) {
          if (a.mode === 'none' || b.mode === 'none') match.bet = { mode: 'none', amount: 0, selections: match.bet.selections, locked: true };
          else {
            if (a.amount !== b.amount) throw new Error('Les deux joueurs doivent choisir exactement la même mise.');
            const userA = await tx.get(db.collection('users').doc(match.players[0]));
            const userB = await tx.get(db.collection('users').doc(match.players[1]));
            if (!userA.exists || !userB.exists) throw new Error('Utilisateur introuvable.');
            if ((userA.data().gems || 0) < a.amount || (userB.data().gems || 0) < b.amount) throw new Error("Un joueur n'a pas assez de gemmes.");
            match.bet = { mode: 'bet', amount: a.amount, selections: match.bet.selections, locked: true };
          }
        }
        tx.set(matchRef, match); return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    if (action === 'start') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (!match.players.includes(id) || match.status !== 'betting') throw new Error('Le match ne peut pas démarrer maintenant.');
        if (!match.bet || !match.bet.locked) throw new Error('Les deux joueurs doivent terminer le choix du pari.');
        if (match.bet.mode === 'bet') {
          const amount = match.bet.amount;
          const refA = db.collection('users').doc(match.players[0]);
          const refB = db.collection('users').doc(match.players[1]);
          const a = await tx.get(refA), b = await tx.get(refB);
          if (!a.exists || !b.exists || (a.data().gems || 0) < amount || (b.data().gems || 0) < amount) throw new Error('Un joueur ne possède plus assez de gemmes.');
          tx.update(refA, { gems: admin.firestore.FieldValue.increment(-amount) });
          tx.update(refB, { gems: admin.firestore.FieldValue.increment(-amount) });
          match.bet.pot = amount * 2;
        } else match.bet.pot = 0;
        match.status = 'live'; match.startedAt = Date.now();
        tx.set(matchRef, match); return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    if (action === 'tick') {
      const result = await db.runTransaction(async tx => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (!match.players.includes(id)) throw new Error('Vous ne participez pas à ce match.');
        if (match.status !== 'live') return match;
        match.time += Math.floor(Math.random() * 5) + 3;
        if (match.time >= 90) { match.time = 90; match.status = 'finished'; match.finishedAt = Date.now(); }
        const homeName = match.teamNames?.[match.players[0]] || `Équipe de ${match.players[0]}`;
        const awayName = match.teamNames?.[match.players[1]] || `Équipe de ${match.players[1]}`;
        const diff = match.hostOvr - match.guestOvr, chance = Math.random() * 100;
        let text = randomComment(), type = '';
        if (chance < 40 + diff * 0.7 && Math.random() > 0.4) { match.homeScore++; text = `⚽ BUT ! ${homeName} marque ! (${match.homeScore}-${match.awayScore})`; type = 'goal'; }
        else if (chance > 65 - diff * 0.5 && Math.random() > 0.65) { match.awayScore++; text = `⚽ BUT ! ${awayName} marque ! (${match.homeScore}-${match.awayScore})`; type = 'away-goal'; }
        match.events = [...(match.events || []), { time: match.time, text, type }].slice(-60);
        if (match.status === 'finished') {
          const refA = db.collection('users').doc(match.players[0]), refB = db.collection('users').doc(match.players[1]);
          const draw = match.homeScore === match.awayScore;
          if (match.bet?.mode === 'bet' && match.bet.pot > 0) {
            if (draw) { const refund = match.bet.amount; tx.update(refA, { gems: admin.firestore.FieldValue.increment(refund) }); tx.update(refB, { gems: admin.firestore.FieldValue.increment(refund) }); match.resultPrize = 'Remboursement des mises'; }
            else { const winnerRef = match.homeScore > match.awayScore ? refA : refB; tx.update(winnerRef, { gems: admin.firestore.FieldValue.increment(match.bet.pot) }); match.resultPrize = `${match.bet.pot} gemmes`; }
          } else match.resultPrize = 'Aucune gemme en jeu';
        }
        tx.set(matchRef, match); return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) { console.error(e); return res.status(400).json({ error: e.message || 'Erreur serveur.' }); }
};
