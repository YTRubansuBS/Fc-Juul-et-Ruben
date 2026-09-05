module.exports = async (req, res) => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let parseOk = false;
  let parseError = null;
  let projectId = null;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      parseOk = true;
      projectId = parsed.project_id || null;
    } catch (e) {
      parseError = e.message;
    }
  }

  return res.status(200).json({
    variableExiste: !!raw,
    longueurTexte: raw ? raw.length : 0,
    commenceParAccolade: raw ? raw.trim().startsWith('{') : false,
    finitParAccolade: raw ? raw.trim().endsWith('}') : false,
    jsonValide: parseOk,
    erreurJson: parseError,
    projectIdDetecte: projectId
  });
};
