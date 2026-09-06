const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  }
  return admin.firestore();
}

const ONLINE_WINDOW_MS = 45000;
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
          match.status = 'live';
          match.guestOvr = Math.round(myOvr) || 70;
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
        if (match.players[0] !== id) throw new Error("Seul l'hôte du match fait avancer la simulation.");
        if (match.status !== 'live') return match;

        match.time += Math.floor(Math.random() * 5) + 3;
        if (match.time >= 90) {
          match.time = 90;
          match.status = 'finished';
          match.finishedAt = Date.now();
        }

        const diff = match.hostOvr - match.guestOvr;
        const chance = Math.random() * 100;
        let text = '';
        let type = '';
        if (chance < 40 + diff * 0.7) {
          if (Math.random() > 0.4) {
            match.homeScore++;
            text = `⚽ BUT ! L'équipe hôte marque ! (${match.homeScore}-${match.awayScore})`;
            type = 'goal';
          } else {
            text = randomComment();
          }
        } else if (chance > 65 - diff * 0.5) {
          if (Math.random() > 0.65) {
            match.awayScore++;
            text = `❌ But de l'équipe invitée ! (${match.homeScore}-${match.awayScore})`;
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
          tx.update(db.collection('users').doc(match.players[0]), { gems: admin.firestore.FieldValue.increment(hostPrize) });
          tx.update(db.collection('users').doc(match.players[1]), { gems: admin.firestore.FieldValue.increment(guestPrize) });
          match.hostPrize = hostPrize;
          match.guestPrize = guestPrize;
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
