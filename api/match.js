const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  }
  return admin.firestore();
}

const ONLINE_WINDOW_MS = 90000;
const MATCH_REWARD = 800;

async function checkAuth(db, id, password) {
  const ref = db.collection('users').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data().password !== password) return null;
  return { ref, data: snap.data() };
}

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

function randomComment() {
  return baseCommentaries[Math.floor(Math.random() * baseCommentaries.length)];
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
          if (data.status === 'pending' && data.players[1] === id) list.push({ id: d.id, from: data.players[0] });
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
      if (!(me.data.friends || []).includes(target)) {
        return res.status(403).json({ error: "Vous n'êtes pas amis avec cet utilisateur." });
      }

      const targetSnap = await db.collection('users').doc(target).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Cet utilisateur n'existe pas." });
      const targetData = targetSnap.data();
      if (Date.now() - (targetData.lastActive || 0) > ONLINE_WINDOW_MS) {
        return res.status(409).json({ error: "Cet ami n'est pas connecté actuellement." });
      }

      const matchRef = db.collection('matches').doc();
      const matchData = {
        players: [id, target],
        hostOvr: Math.round(myOvr) || 70,
        guestOvr: 0,
        hostBet: null,
        guestBet: null,
        status: 'pending',
        time: 0,
        homeScore: 0,
        awayScore: 0,
        events: [],
        reward: MATCH_REWARD,
        createdAt: Date.now(),
        finishedAt: null
      };
      await matchRef.set(matchData);
      return res.status(200).json({ id: matchRef.id, ...matchData });
    }

    const { matchId } = body;
    if (!matchId) return res.status(400).json({ error: 'matchId requis.' });
    const matchRef = db.collection('matches').doc(matchId);

    if (action === 'respond') {
      const { accept, myOvr } = body;
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (match.players[1] !== id) throw new Error("Vous n'êtes pas invité à ce match.");
        if (match.status !== 'pending') throw new Error("Cette invitation n'est plus valide.");
        if (!accept) {
          match.status = 'declined';
        } else {
          match.status = 'betting';
          match.guestOvr = Math.round(myOvr) || 70;
        }
        tx.set(matchRef, match);
        return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    if (action === 'setBet') {
      const { bet } = body;
      const betAmount = Math.max(0, Math.floor(Number(bet)) || 0);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (!match.players.includes(id)) throw new Error("Vous ne participez pas à ce match.");
        if (match.status !== 'betting') throw new Error("La phase de mise est terminée.");

        const isHostPlayer = match.players[0] === id;
        if (isHostPlayer && match.hostBet !== null) throw new Error('Mise déjà effectuée.');
        if (!isHostPlayer && match.guestBet !== null) throw new Error('Mise déjà effectuée.');

        const userRef = db.collection('users').doc(id);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error('Utilisateur introuvable.');
        const userData = userSnap.data();
        if (betAmount > 0) {
          if ((userData.gems || 0) < betAmount) throw new Error("Vous n'avez pas assez de gemmes pour cette mise.");
          tx.update(userRef, { gems: admin.firestore.FieldValue.increment(-betAmount) });
        }

        if (isHostPlayer) match.hostBet = betAmount;
        else match.guestBet = betAmount;

        if (match.hostBet !== null && match.guestBet !== null) {
          match.status = 'live';
        }

        tx.set(matchRef, match);
        return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    if (action === 'tick') {
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(matchRef);
        if (!snap.exists) throw new Error('Match introuvable.');
        const match = snap.data();
        if (match.players[0] !== id) throw new Error("Seul celui qui a envoyé l'invitation fait avancer la simulation.");
        if (match.status !== 'live') return match;

        const hostName = match.players[0];
        const guestName = match.players[1];

        match.time += Math.floor(Math.random() * 5) + 3;
        if (match.time >= 90) {
          match.time = 90;
          match.status = 'finished';
          match.finishedAt = Date.now();
        }

        const diff = match.hostOvr - match.guestOvr;
        const BASE = 0.30, COEF = 0.007, MIN_A = 0.04, MAX_A = 0.62;
        const pHost = Math.min(MAX_A, Math.max(MIN_A, BASE + diff * COEF));
        const pGuest = Math.min(MAX_A, Math.max(MIN_A, BASE - diff * COEF));
        const CONV_BASE = 0.30, CONV_COEF = 0.003, CONV_MIN = 0.15, CONV_MAX = 0.55;
        const convHost = Math.min(CONV_MAX, Math.max(CONV_MIN, CONV_BASE + diff * CONV_COEF));
        const convGuest = Math.min(CONV_MAX, Math.max(CONV_MIN, CONV_BASE - diff * CONV_COEF));

        const r = Math.random();
        let text = '';
        let type = '';
        if (r < pHost) {
          if (Math.random() < convHost) {
            match.homeScore++;
            text = `⚽ BUT ! L'équipe de ${hostName} marque ! (${match.homeScore}-${match.awayScore})`;
            type = 'goal';
          } else {
            text = randomComment();
          }
        } else if (r < pHost + pGuest) {
          if (Math.random() < convGuest) {
            match.awayScore++;
            text = `❌ But de l'équipe de ${guestName} ! (${match.homeScore}-${match.awayScore})`;
            type = 'away-goal';
          } else {
            text = randomComment();
          }
        } else {
          text = randomComment();
        }
        match.events = [...(match.events || []), { time: match.time, text, type }].slice(-60);

        if (match.status === 'finished') {
          const won = match.homeScore > match.awayScore;
          const draw = match.homeScore === match.awayScore;
          const hostPrize = won ? match.reward : (draw ? Math.floor(match.reward / 3) : 60);
          const guestPrize = (!won && !draw) ? match.reward : (draw ? Math.floor(match.reward / 3) : 60);

          const hostBet = match.hostBet || 0;
          const guestBet = match.guestBet || 0;
          const pot = hostBet + guestBet;
          let hostBetPayout = 0;
          let guestBetPayout = 0;
          if (pot > 0) {
            if (won) hostBetPayout = pot;
            else if (!won && !draw) guestBetPayout = pot;
            else { hostBetPayout = hostBet; guestBetPayout = guestBet; } // égalité : chacun récupère sa mise
          }

          tx.update(db.collection('users').doc(hostName), { gems: admin.firestore.FieldValue.increment(hostPrize + hostBetPayout) });
          tx.update(db.collection('users').doc(guestName), { gems: admin.firestore.FieldValue.increment(guestPrize + guestBetPayout) });
          match.hostPrize = hostPrize;
          match.guestPrize = guestPrize;
          match.hostBetPayout = hostBetPayout;
          match.guestBetPayout = guestBetPayout;
        }

        tx.set(matchRef, match);
        return match;
      });
      return res.status(200).json({ id: matchId, ...result });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e.message || 'Erreur serveur.' });
  }
};
