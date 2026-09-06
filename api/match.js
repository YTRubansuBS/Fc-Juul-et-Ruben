// Récupérer les matchs en attente / en phase de pari
async function checkPendingMatches() {
  try {
    const res = await fetch(`/api/match?action=pending&id=${currentUser.id}`);
    const list = await res.json();
    renderPendingMatches(list);
  } catch (e) {
    console.error(e);
  }
}

// Inviter un ami à un match en envoyant son GÉN actuel
async function inviteMatch(targetId) {
  const myOvr = parseInt(document.getElementById('team-ovr').innerText) || 70;
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'invite', 
        id: currentUser.id, 
        password: currentUser.password, 
        target: targetId, 
        myOvr 
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    openMatchLobby(data.id);
  } catch (e) {
    alert("Erreur");
  }
}

// Répondre à une invitation de match
async function respondMatch(matchId, accept) {
  const myOvr = parseInt(document.getElementById('team-ovr').innerText) || 70;
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'respond', 
        id: currentUser.id, 
        password: currentUser.password, 
        matchId, 
        accept, 
        myOvr 
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    openMatchLobby(matchId);
  } catch (e) {
    alert("Erreur");
  }
}

// Choisir un pari (mode 'none' ou 'bet' avec un montant)
async function setMatchBet(matchId, mode, amount = 0) {
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'bet', 
        id: currentUser.id, 
        password: currentUser.password, 
        matchId, 
        mode, 
        amount 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  } catch (e) {
    console.error(e);
  }
}

// Démarrer le match (après verrouillage des paris)
async function startMatchApi(matchId) {
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'start', 
        id: currentUser.id, 
        password: currentUser.password, 
        matchId 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else runLiveMatchSimulation(matchId);
  } catch (e) {
    console.error(e);
  }
}

// Avancer d'un tour (tick) pour simuler le match en direct
async function tickMatch(matchId) {
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'tick', 
        id: currentUser.id, 
        password: currentUser.password, 
        matchId 
      })
    });
    return await res.json();
  } catch (e) {
    console.error(e);
  }
}
