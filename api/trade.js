// Récupérer les échanges en attente
async function checkPendingTrades() {
  try {
    const res = await fetch(`/api/trade?action=pending&id=${currentUser.id}`);
    const list = await res.json();
    // Mettre à jour l'interface des invitations d'échanges en attente
    renderPendingTrades(list);
  } catch (e) {
    console.error(e);
  }
}

// Créer un échange avec un ami
async function createTrade(targetId) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'create', 
        id: currentUser.id, 
        password: currentUser.password, 
        target: targetId 
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    openTradeModal(data.id);
  } catch (e) {
    alert("Erreur de connexion");
  }
}

// Accepter ou refuser un échange
async function respondTrade(tradeId, accept) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'respond', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId, 
        accept 
      })
    });
    const data = await res.json();
    if (data.error) return alert(data.error);
    if (accept) openTradeModal(tradeId);
    else checkPendingTrades();
  } catch (e) {
    alert("Erreur");
  }
}

// Proposer des cartes et des gemmes
async function sendTradeOffer(tradeId, cards, gems) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'offer', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId, 
        cards, 
        gems 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  } catch (e) {
    console.error(e);
  }
}

// Envoyer un message dans le chat de l'échange
async function sendTradeMessage(tradeId, text) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'message', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId, 
        text 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  } catch (e) {
    console.error(e);
  }
}

// Basculer l'état "Prêt"
async function setTradeReady(tradeId, readyState) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'ready', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId, 
        ready: readyState 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  } catch (e) {
    console.error(e);
  }
}

// Confirmer l'échange (lance le compte à rebours de 5s si les deux sont prêts)
async function confirmTrade(tradeId) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'confirm', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
  } catch (e) {
    console.error(e);
  }
}

// Finaliser l'échange après le compte à rebours
async function finalizeTrade(tradeId) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        action: 'finalize', 
        id: currentUser.id, 
        password: currentUser.password, 
        tradeId 
      })
    });
    const data = await res.json();
    if (data.error) alert(data.error);
    else {
      alert("Échange réussi !");
      closeTradeModal();
      loadUserData(); // Recharge les données utilisateur (inventaire, gemmes)
    }
  } catch (e) {
    console.error(e);
  }
}
