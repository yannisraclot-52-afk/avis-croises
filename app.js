const PROPOSAL_COUNT = 30;
const CHOICES = [
  { value: -2, label: 'Je déteste', short: 'Déteste', color: 'coral' },
  { value: -1, label: "Je n'aime pas", short: "N'aime pas", color: 'rose' },
  { value: 0, label: 'Neutre / je m’en fiche', short: 'Neutre', color: 'stone' },
  { value: 1, label: "J'aime un peu", short: 'Aime un peu', color: 'sage' },
  { value: 2, label: 'J’aime beaucoup', short: 'Aime beaucoup', color: 'green' },
];
const appView = document.querySelector('#app-view');
const navButtons = [...document.querySelectorAll('[data-view]')];
const proposals = Array.isArray(window.PROPOSITIONS) ? window.PROPOSITIONS.slice(0, PROPOSAL_COUNT) : [];
const config = window.SURVEY_CONFIG || {};
let responses = loadJson(config.responseStorageKey, []);
let draft = loadJson(config.draftStorageKey, { name: '', answers: [], index: 0, started: false });
let groupNames = loadJson(config.groupNamesStorageKey, {});
let activeView = 'survey';
let adminUnlocked = false;
let showingMyResults = false;
let selectedIndividualId = null;
let remoteDataReady = !SurveyStorage.isRemote;
let remoteDataError = '';
let submissionError = '';
let submissionPending = false;

if (draft.started && !Array.isArray(draft.order)) {
  draft.order = Array.from({ length: PROPOSAL_COUNT }, (_, index) => index);
  localStorage.setItem(config.draftStorageKey, JSON.stringify(draft));
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function saveDraft() {
  localStorage.setItem(config.draftStorageKey, JSON.stringify(draft));
}

function saveResponses() {
  localStorage.setItem(config.responseStorageKey, JSON.stringify(responses));
}

function saveGroupNames() {
  localStorage.setItem(config.groupNamesStorageKey, JSON.stringify(groupNames));
}

function responseIdentity(response) {
  return response.id || `${response.name}|${response.completedAt || ''}|${response.answers.join(',')}`;
}

function responseFingerprint(response) {
  return `${response.name.trim().toLocaleLowerCase('fr')}|${response.completedAt || ''}|${response.answers.join(',')}`;
}

function createResponseId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function shuffledProposalOrder() {
  const usedOrders = new Set(responses.map((response) => response.questionOrder?.join(',')).filter(Boolean));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const order = Array.from({ length: PROPOSAL_COUNT }, (_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    }
    if (!usedOrders.has(order.join(','))) return order;
  }
  for (let offset = 0; offset < PROPOSAL_COUNT; offset += 1) {
    const order = Array.from({ length: PROPOSAL_COUNT }, (_, index) => (index + offset) % PROPOSAL_COUNT);
    if (!usedOrders.has(order.join(','))) return order;
  }
  return Array.from({ length: PROPOSAL_COUNT }, (_, index) => index);
}

function groupSignature(members) {
  let hash = 2166136261;
  for (const character of members.map(responseIdentity).sort().join('|')) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return `cluster-${hash.toString(36)}`;
}

function summarizeGroups(items) {
  const assignments = Clustering.clusterResponses(items);
  const count = Math.max(...assignments) + 1;
  const globalMeans = Array.from({ length: PROPOSAL_COUNT }, (_, question) => items.reduce((sum, item) => sum + Number(item.answers[question]), 0) / items.length);
  const groups = Array.from({ length: count }, (_, index) => {
    const members = items.filter((_, itemIndex) => assignments[itemIndex] === index);
    const signature = groupSignature(members);
    const proposalStats = Array.from({ length: PROPOSAL_COUNT }, (_, question) => {
      const distribution = Array(CHOICES.length).fill(0);
      let total = 0;
      members.forEach((member) => {
        const answer = Number(member.answers[question]);
        total += answer;
        distribution[answer + 2] += 1;
      });
      const average = total / members.length;
      const modeCount = Math.max(...distribution);
      const agreement = modeCount / members.length;
      const difference = average - globalMeans[question];
      const importance = Math.round(Math.abs(difference) / 4 * agreement * 100);
      const mode = distribution.indexOf(modeCount) - 2;
      return {
        question,
        name: proposals[question],
        average,
        mode,
        agreement: Math.round(agreement * 100),
        difference,
        importance,
        distribution,
      };
    });
    let similarityTotal = 0;
    let pairCount = 0;
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        similarityTotal += Clustering.similarity(members[left].answers, members[right].answers);
        pairCount += 1;
      }
    }
    return {
      index,
      signature,
      name: groupNames[signature]?.trim() || `Groupe ${index + 1}`,
      members,
      cohesion: pairCount ? Math.round(similarityTotal / pairCount) : 100,
      proposals: proposalStats.sort((left, right) => right.importance - left.importance),
    };
  });
  const differentiators = Array.from({ length: PROPOSAL_COUNT }, (_, question) => {
    const groupMeans = groups.map((group) => group.proposals.find((proposal) => proposal.question === question).average);
    const high = Math.max(...groupMeans);
    const low = Math.min(...groupMeans);
    const leaders = groups.filter((group, index) => groupMeans[index] === high).map((group) => group.name);
    return { question, name: proposals[question], high, low, gap: high - low, leaders };
  }).sort((left, right) => right.gap - left.gap);
  return { groups, differentiators };
}

function formatAverage(value) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function opinionLabel(value) {
  const index = Math.max(0, Math.min(CHOICES.length - 1, Math.round(value) + 2));
  return CHOICES[index].short;
}

function setView(view) {
  if (view !== 'admin') {
    adminUnlocked = false;
    if (SurveyStorage.isRemote) void SurveyStorage.signOut();
  }
  activeView = view;
  navButtons.forEach((button) => {
    const selected = button.dataset.view === view;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  render();
}

function render() {
  if (proposals.length !== PROPOSAL_COUNT) {
    appView.innerHTML = `<div class="empty-notice"><h2>Les propositions ne sont pas prêtes.</h2><p>Le questionnaire attend une liste de ${PROPOSAL_COUNT} noms dans <code>propositions.js</code>.</p></div>`;
    return;
  }
  if (SurveyStorage.isRemote && !remoteDataReady) {
    appView.innerHTML = '<div class="loading-state"><span class="loader"></span><span>Connexion à la base partagée…</span></div>';
    return;
  }
  if (remoteDataError) {
    appView.innerHTML = `<div class="error-state"><h3>Connexion à la base impossible.</h3><p>${escapeHtml(remoteDataError)}</p><button class="outline-button" type="button" data-action="retry-storage">Réessayer</button></div>`;
    return;
  }
  if (activeView === 'admin') {
    appView.innerHTML = adminUnlocked ? renderAdmin() : renderAdminLogin();
    return;
  }
  appView.innerHTML = renderSurvey();
}

async function reloadRemoteData() {
  if (!SurveyStorage.isRemote) return;
  remoteDataReady = false;
  remoteDataError = '';
  render();
  try {
    [responses, groupNames] = await Promise.all([SurveyStorage.loadResponses(), SurveyStorage.loadGroupNames()]);
  } catch (error) {
    remoteDataError = error.message || 'Vérifie les identifiants Supabase et le schéma de base de données.';
  }
  remoteDataReady = true;
  render();
}

function renderSurvey() {
  if (draft.finished) return showingMyResults ? renderParticipantResults() : renderThankYou();
  if (!draft.started) return renderWelcome();
  const index = Math.min(draft.index, PROPOSAL_COUNT - 1);
  const questionIndex = draft.order?.[index] ?? index;
  const selected = draft.answers[questionIndex];
  const progress = Math.round((index / PROPOSAL_COUNT) * 100);
  return `
    <div class="survey-layout">
      <aside class="progress-rail" aria-label="Progression du questionnaire">
        <div class="progress-copy"><span>Progression</span><strong>${index + 1}<i> / ${PROPOSAL_COUNT}</i></strong></div>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${PROPOSAL_COUNT}" aria-valuenow="${index}"><span style="width:${progress}%"></span></div>
        <p>${escapeHtml(draft.name)}</p>
        <span class="progress-index">AVIS ${String(index + 1).padStart(2, '0')}</span>
      </aside>
      <section class="question-stage" aria-labelledby="question-title">
        <div class="question-meta"><span>Proposition ${String(index + 1).padStart(2, '0')}</span><span>${PROPOSAL_COUNT - index} restantes</span></div>
        <h2 id="question-title">Quel est ton avis sur<br><em>${escapeHtml(proposals[questionIndex])} ?</em></h2>
        <div class="choice-list" role="group" aria-label="Choisir un avis">
          ${CHOICES.map((choice) => `
            <button type="button" class="choice choice-${choice.color} ${selected === choice.value ? 'is-selected' : ''}" data-answer="${choice.value}" aria-pressed="${selected === choice.value}">
              <span class="choice-mark" aria-hidden="true"></span><span>${choice.label}</span><span class="choice-index">${String(CHOICES.indexOf(choice) + 1).padStart(2, '0')}</span>
            </button>`).join('')}
        </div>
        <div class="question-actions">
          <button type="button" class="back-button" data-action="back" ${index === 0 ? 'disabled' : ''}><span aria-hidden="true">←</span> Précédent</button>
          <button type="button" class="next-button" data-action="next" ${selected === undefined || submissionPending ? 'disabled' : ''}>${submissionPending ? 'Enregistrement…' : index === PROPOSAL_COUNT - 1 ? 'Terminer' : 'Continuer'} <span aria-hidden="true">→</span></button>
        </div>
        ${submissionError ? `<p class="form-error" role="alert">${escapeHtml(submissionError)}</p>` : ''}
      </section>
    </div>`;
}

function renderWelcome() {
  return `
    <section class="welcome-panel" aria-labelledby="welcome-title">
      <div class="welcome-number">01 <span>/ ${PROPOSAL_COUNT}</span></div>
      <div class="welcome-content">
        <p class="section-label">Avant de commencer</p>
        <h2 id="welcome-title">Tes réponses,<br><em>ton regard.</em></h2>
        <p class="welcome-copy">Pour chaque personne, choisis la nuance qui te correspond le mieux. Tu pourras revenir à la question précédente. Ton résultat ne sera pas affiché à la fin.</p>
        <form id="start-form" class="start-form">
          <label for="respondent-name">Ton prénom ou ton pseudo</label>
          <div class="start-row"><input id="respondent-name" name="name" maxlength="40" autocomplete="nickname" placeholder="Ex. Alex" required value="${escapeHtml(draft.name || '')}"><button class="next-button" type="submit">Commencer <span aria-hidden="true">→</span></button></div>
          <label class="consent-check"><input name="consent" type="checkbox" required><span>J’accepte que mon prénom ou pseudo et mes réponses soient partagés avec les autres répondants et l’administrateur.</span></label>
        </form>
        <p class="local-note"><span aria-hidden="true">●</span> ${SurveyStorage.isRemote ? 'Les réponses sont partagées en ligne avec tous les répondants.' : 'Version locale : les réponses sont enregistrées sur cet appareil.'}</p>
      </div>
      <div class="welcome-aside" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="orbit orbit-three"></span><span class="orbit-center">AC</span><span class="aside-caption">30 regards<br>une même question</span></div>
      <form id="restore-form" class="restore-form">
        <label for="recovery-code">Déjà répondu ? Retrouve ton profil avec ton code retour.</label>
        <div class="start-row"><input id="recovery-code" name="recoveryCode" maxlength="24" autocomplete="off" placeholder="Ton code retour" required><button class="outline-button" type="submit">Retrouver mon profil</button></div>
        <p class="restore-note">${SurveyStorage.isRemote ? 'Ton code te permet de retrouver ton profil depuis un autre appareil.' : 'Le code fonctionne sur le navigateur où ta réponse a été enregistrée.'}</p>
        <p id="restore-error" class="form-error" role="alert"></p>
      </form>
    </section>`;
}

function renderThankYou() {
  const payload = { format: 1, name: draft.name, answers: draft.answers, questionOrder: draft.order, completedAt: draft.completedAt, recoveryCode: draft.recoveryCode };
  return `
    <section class="completion-panel" aria-labelledby="completion-title">
      <div class="completion-stamp" aria-hidden="true">30<span>/30</span></div>
      <p class="section-label">Questionnaire terminé</p>
      <h2 id="completion-title">Merci, ${escapeHtml(draft.name)}.<br><em>Ton avis compte.</em></h2>
      <p>${SurveyStorage.isRemote ? 'Garde ce code pour retrouver ton profil et ses nouvelles comparaisons depuis n’importe quel ordinateur.' : 'Garde ce code pour retrouver ton profil sur ce navigateur. Une base partagée sera nécessaire pour le retrouver depuis un autre ordinateur.'}</p>
      <div class="recovery-code"><span>Ton code retour</span><strong>${escapeHtml(draft.recoveryCode || '')}</strong></div>
      <div class="completion-actions"><button class="next-button" type="button" data-action="view-my-results">Voir l'évolution <span aria-hidden="true">→</span></button><button class="outline-button" type="button" data-action="download-mine">Télécharger ma réponse <span aria-hidden="true">↓</span></button><button class="back-button" type="button" data-action="new-response">Nouvelle réponse</button></div>
      <script type="application/json" id="response-payload">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
    </section>`;
}

function renderAdminLogin() {
  const credentials = SurveyStorage.isRemote
    ? '<label for="admin-email">Adresse e-mail</label><input id="admin-email" type="email" autocomplete="username" required><label for="admin-password">Mot de passe</label><input id="admin-password" type="password" autocomplete="current-password" required><button class="next-button" type="submit">Connexion admin <span aria-hidden="true">→</span></button>'
    : '<label for="admin-code">Code administrateur</label><div class="start-row"><input id="admin-code" type="password" autocomplete="current-password" required><button class="next-button" type="submit">Ouvrir <span aria-hidden="true">→</span></button></div>';
  const adminDescription = SurveyStorage.isRemote
    ? 'Connecte-toi avec le compte administrateur Supabase autorisé pour ce questionnaire.'
    : 'Entre le code local pour consulter et exporter les réponses enregistrées sur cet appareil.';
  return `
    <section class="admin-login" aria-labelledby="admin-title">
      <div class="admin-login-mark" aria-hidden="true">AC</div>
      <div><p class="section-label">Espace réservé</p><h2 id="admin-title">Administration</h2><p>${adminDescription}</p>
        <form id="admin-form" class="admin-form">${credentials}<p id="admin-error" class="form-error" role="alert"></p></form>
        ${SurveyStorage.isRemote ? '' : '<p class="security-note"><strong>Prototype local.</strong> Le code de démonstration est visible dans les fichiers et ne protège pas les réponses d’un site public.</p>'}
      </div>
    </section>`;
}

function renderClusterGraph(items, { highlightId = null, revealNames = true, groupLabels = {} } = {}) {
  if (!items.length) return '<div class="empty-notice"><h3>Pas encore de résultats</h3><p>Importe des réponses terminées pour afficher les regroupements.</p></div>';
  const assignments = Clustering.clusterResponses(items);
  const clusterCount = Math.max(...assignments) + 1;
  const projection = Clustering.projectResponses(items);
  const palette = ['#58e0ba', '#ff9778', '#79a7ff', '#ffd46f', '#df9df7'];
  const groups = Array.from({ length: clusterCount }, (_, index) => items.map((item, itemIndex) => ({ item, itemIndex })).filter((entry) => assignments[entry.itemIndex] === index));
  const names = groups.map((group, index) => groupLabels[groupSignature(group.map((entry) => entry.item))] || `Groupe ${index + 1}`);
  const clusterCenters = groups.map((group) => group.reduce((center, entry) => ({
    x: center.x + projection.points[entry.itemIndex].x / group.length,
    y: center.y + projection.points[entry.itemIndex].y / group.length,
  }), { x: 0, y: 0 }));
  const coordinates = items.map((item, itemIndex) => {
    const clusterIndex = assignments[itemIndex];
    const point = projection.points[itemIndex];
    const clusterMembers = groups[clusterIndex];
    const memberIndex = clusterMembers.findIndex((entry) => entry.itemIndex === itemIndex);
    const angle = memberIndex * 2.39996;
    const radius = clusterMembers.length > 1 ? 15 + Math.sqrt(memberIndex) * Math.min(14, 86 / Math.sqrt(clusterMembers.length)) : 0;
    const center = clusterCenters[clusterIndex];
    return {
      x: center.x + (point.x - center.x) * 0.72 + Math.cos(angle) * radius,
      y: center.y + (point.y - center.y) * 0.72 + Math.sin(angle) * radius,
    };
  });
  const backgroundStars = Array.from({ length: 88 }, (_, index) => {
    const x = 14 + (index * 137.508) % 972;
    const y = 52 + (index * 79.31) % 392;
    const radius = 0.6 + (index % 4) * 0.34;
    const opacity = 0.15 + (index % 5) * 0.09;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="#d5e6ff" opacity="${opacity.toFixed(2)}"/>`;
  }).join('');
  const nebulae = groups.map((group, index) => {
    const center = clusterCenters[index];
    const radiusX = Math.min(155, 65 + Math.sqrt(group.length) * 28);
    const radiusY = Math.min(115, 40 + Math.sqrt(group.length) * 19);
    return `<ellipse class="cluster-nebula" cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" rx="${radiusX.toFixed(1)}" ry="${radiusY.toFixed(1)}" fill="${palette[index % palette.length]}"/>`;
  }).join('');
  const edges = new Set();
  items.forEach((item, itemIndex) => {
    const nearest = items.map((other, otherIndex) => ({ otherIndex, cluster: assignments[otherIndex], distance: Clustering.averageDifference(item.answers, other.answers) }))
      .filter((entry) => entry.otherIndex !== itemIndex && entry.cluster === assignments[itemIndex])
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2);
    nearest.forEach(({ otherIndex }) => edges.add(`${Math.min(itemIndex, otherIndex)}:${Math.max(itemIndex, otherIndex)}`));
  });
  const constellationLines = [...edges].map((edge) => {
    const [leftIndex, rightIndex] = edge.split(':').map(Number);
    const left = coordinates[leftIndex];
    const right = coordinates[rightIndex];
    const color = palette[assignments[leftIndex] % palette.length];
    return `<line class="match-line" x1="${left.x.toFixed(1)}" y1="${left.y.toFixed(1)}" x2="${right.x.toFixed(1)}" y2="${right.y.toFixed(1)}" stroke="${color}"/>`;
  }).join('');
  const groupCaptions = groups.map((group, groupIndex) => {
    let totalSimilarity = 0;
    let pairCount = 0;
    group.forEach((entry, index) => group.slice(index + 1).forEach((other) => {
      totalSimilarity += Clustering.similarity(entry.item.answers, other.item.answers);
      pairCount += 1;
    }));
    const cohesion = pairCount ? Math.round(totalSimilarity / pairCount) : 100;
    const center = clusterCenters[groupIndex];
    return `<g class="cluster-label"><text x="${center.x.toFixed(1)}" y="${Math.min(478, center.y + 82).toFixed(1)}" text-anchor="middle">${escapeHtml(names[groupIndex])} · ${group.length} PROFILS</text><text class="cluster-label-score" x="${center.x.toFixed(1)}" y="${Math.min(494, center.y + 99).toFixed(1)}" text-anchor="middle">${cohesion}% DE SIMILARITÉ</text></g>`;
  }).join('');
  const nodes = items.map((item, itemIndex) => {
    const clusterIndex = assignments[itemIndex];
    const { x, y } = coordinates[itemIndex];
    const name = revealNames ? item.name : item.id === highlightId ? 'Ton profil' : `Groupe ${clusterIndex + 1}`;
    const tooltipWidth = Math.max(58, name.length * 7 + 18);
    const tooltipX = Math.max(tooltipWidth / 2 + 5, Math.min(995 - tooltipWidth / 2, x));
    const tooltipY = Math.max(24, y - 17);
    const highlighted = item.id === highlightId;
    return `<g class="graph-node ${highlighted ? 'is-highlighted' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(name)}, groupe ${clusterIndex + 1}"><title>${escapeHtml(name)} · groupe ${clusterIndex + 1}</title><circle class="star-aura" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${palette[clusterIndex % palette.length]}"/><circle class="star-core" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${highlighted ? 7 : 5.5}" fill="${palette[clusterIndex % palette.length]}"/><g class="graph-tooltip" transform="translate(${tooltipX.toFixed(1)}, ${tooltipY.toFixed(1)})"><rect x="${(-tooltipWidth / 2).toFixed(1)}" y="-22" width="${tooltipWidth.toFixed(1)}" height="25" rx="3"/><text x="0" y="-5" text-anchor="middle">${escapeHtml(name)}</text></g></g>`;
  }).join('');
  const legend = groups.map((group, index) => `<span><i style="--legend-color:${palette[index % palette.length]}"></i>${escapeHtml(names[index])} <b>${group.length}</b></span>`).join('');
  return `<div class="graph-wrap"><svg class="cluster-graph" viewBox="0 0 1000 500" role="img" aria-label="Carte galactique des profils. Les couleurs indiquent les groupes; les lignes relient les avis proches."><defs><filter id="nebula-blur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="24"/></filter><filter id="star-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3"/></filter></defs><g class="star-field" aria-hidden="true">${backgroundStars}</g><g class="nebula-layer" aria-hidden="true">${nebulae}</g><g class="constellation-lines" aria-hidden="true">${constellationLines}</g><text x="24" y="26" class="graph-axis-label">AXE 01 · ${projection.firstPercent}%</text><text x="24" y="44" class="graph-axis-label">AXE 02 · ${projection.secondPercent}%</text>${groupCaptions}${nodes}</svg></div><div class="graph-legend">${legend}</div>`;
}

function renderGroupDetails(group) {
  const rankedSignals = group.proposals.filter((proposal) => proposal.importance > 0).slice(0, 4);
  const strongest = rankedSignals.length
    ? `<ul class="group-signal-list">${rankedSignals.map((proposal) => `<li><span><strong>${escapeHtml(proposal.name)}</strong><small>${escapeHtml(opinionLabel(proposal.average))} · accord ${proposal.agreement}% · écart ${formatAverage(proposal.difference)}</small></span><b>${proposal.importance}/100</b></li>`).join('')}</ul>`
    : '<p class="group-empty-signal">Aucune proposition ne singularise nettement ce groupe par rapport à l’ensemble.</p>';
  const rows = [...group.proposals].sort((left, right) => left.question - right.question).map((proposal) => `
    <tr>
      <th scope="row">${escapeHtml(proposal.name)}</th>
      <td>${formatAverage(proposal.average)}</td>
      <td>${escapeHtml(CHOICES[proposal.mode + 2].short)}</td>
      <td>${proposal.agreement}%</td>
      <td>${formatAverage(proposal.difference)}</td>
      <td><div class="distribution-track" aria-label="Répartition des avis">${proposal.distribution.map((count, index) => `<span style="width:${count / group.members.length * 100}%;background:${['#db7460', '#bd8b84', '#858d91', '#86aa87', '#378d70'][index]}" title="${CHOICES[index].short}: ${count}"></span>`).join('')}</div></td>
    </tr>`).join('');
  return `
    <article class="group-card" style="--group-color:${['#58e0ba', '#ff9778', '#79a7ff', '#ffd46f', '#df9df7'][group.index % 5]}">
      <header class="group-card-heading">
        <div><p class="section-label">Cluster ${String(group.index + 1).padStart(2, '0')}</p><h4>${escapeHtml(group.name)}</h4></div>
        <label>Nom du groupe<input type="text" maxlength="32" value="${escapeHtml(group.name)}" data-group-name="${group.signature}" aria-label="Nom du groupe ${group.index + 1}"></label>
      </header>
      <div class="group-metrics"><div><strong>${group.members.length}</strong><span>personnes</span></div><div><strong>${group.cohesion}%</strong><span>similarité moyenne interne</span></div><div><strong>${rankedSignals.length}</strong><span>signaux distinctifs forts</span></div></div>
      <div class="group-members"><span>Membres du groupe</span><div>${group.members.map((member) => `<span>${escapeHtml(member.name)}</span>`).join('')}</div></div>
      <div class="group-explanation"><h5>Ce qui rapproche ce groupe</h5><p>La cohésion mesure la similarité moyenne entre chaque paire de réponses du groupe. Voici les propositions qui le distinguent le plus de la moyenne générale; elles décrivent une tendance, pas une cause.</p>${strongest}</div>
      <details class="group-distribution"><summary>Explorer les ${PROPOSAL_COUNT} propositions et leur répartition</summary><div class="table-scroll"><table class="insight-table"><thead><tr><th>Proposition</th><th>Moyenne</th><th>Avis dominant</th><th>Accord</th><th>Écart général</th><th>Répartition</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    </article>`;
}

function renderDifferentiators(differentiators) {
  const rows = differentiators.slice(0, 8).map((proposal) => `
    <tr><th scope="row">${escapeHtml(proposal.name)}</th><td>${formatAverage(proposal.gap)} pts</td><td>${escapeHtml(proposal.leaders.join(', '))}</td><td><div class="difference-track"><span style="width:${Math.min(100, proposal.gap / 4 * 100)}%"></span></div></td></tr>`).join('');
  return `<div class="table-scroll"><table class="insight-table differentiator-table"><thead><tr><th>Proposition</th><th>Écart entre groupes</th><th>Groupe(s) avec la moyenne la plus haute</th><th>Amplitude</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function analyzeIndividual(response, pool) {
  const answers = proposals.map((name, question) => {
    const distribution = Array(CHOICES.length).fill(0);
    pool.forEach((other) => { distribution[Number(other.answers[question]) + 2] += 1; });
    const selected = Number(response.answers[question]);
    const selectedCount = distribution[selected + 2];
    const majorityCount = Math.max(...distribution);
    return {
      question,
      name,
      selected,
      selectedCount,
      selectedShare: selectedCount / pool.length,
      majority: selectedCount === majorityCount,
      distribution,
      majorityCount,
    };
  });
  const averagePopularity = answers.reduce((sum, answer) => sum + answer.selectedShare, 0) / answers.length;
  const majorityAnswers = answers.filter((answer) => answer.majority).length;
  const mostConventionalAnswer = [...answers].sort((left, right) => right.selectedShare - left.selectedShare)[0];
  const leastConventionalAnswer = [...answers].sort((left, right) => left.selectedShare - right.selectedShare)[0];
  return {
    answers,
    averagePopularity: Math.round(averagePopularity * 100),
    majorityAnswers,
    majorityShare: Math.round(majorityAnswers / answers.length * 100),
    distinctiveAnswers: answers.filter((answer) => answer.selectedCount === 1).length,
    mostConventionalAnswer,
    leastConventionalAnswer,
  };
}

function renderIndividualDetails(response, pool) {
  const analysis = analyzeIndividual(response, pool);
  const answerRows = analysis.answers.map((answer) => `
    <tr>
      <th scope="row">${escapeHtml(answer.name)}</th>
      <td>${escapeHtml(CHOICES[answer.selected + 2].label)}</td>
      <td>${answer.selectedCount}/${pool.length} · ${Math.round(answer.selectedShare * 100)}%</td>
      <td>${answer.majority ? '<span class="individual-majority">Avis majoritaire</span>' : '<span class="individual-minority">Avis minoritaire</span>'}</td>
      <td><div class="distribution-track" aria-label="Répartition de toutes les réponses">${answer.distribution.map((count, index) => `<span style="width:${count / pool.length * 100}%;background:${['#db7460', '#bd8b84', '#858d91', '#86aa87', '#378d70'][index]}" title="${CHOICES[index].short}: ${count}"></span>`).join('')}</div></td>
    </tr>`).join('');
  return `<section class="individual-detail" aria-labelledby="individual-detail-title"><div class="individual-detail-heading"><div><p class="section-label">Détail individuel</p><h4 id="individual-detail-title">${escapeHtml(response.name)}</h4></div><button class="back-button" type="button" data-action="close-individual">Fermer</button></div><div class="individual-metrics"><div><strong>${analysis.majorityAnswers}/${PROPOSAL_COUNT}</strong><span>réponses alignées avec l'avis majoritaire</span></div><div><strong>${analysis.averagePopularity}%</strong><span>popularité moyenne de ses choix</span></div><div><strong>${analysis.distinctiveAnswers}</strong><span>réponses choisies par cette personne seule</span></div></div><div class="individual-extremes"><p><span>Réponse la plus convenue</span><strong>${escapeHtml(analysis.mostConventionalAnswer.name)}</strong><small>${escapeHtml(CHOICES[analysis.mostConventionalAnswer.selected + 2].label)} · ${analysis.mostConventionalAnswer.selectedCount}/${pool.length} personnes</small></p><p><span>Réponse la plus rare</span><strong>${escapeHtml(analysis.leastConventionalAnswer.name)}</strong><small>${escapeHtml(CHOICES[analysis.leastConventionalAnswer.selected + 2].label)} · ${analysis.leastConventionalAnswer.selectedCount}/${pool.length} personne${analysis.leastConventionalAnswer.selectedCount > 1 ? 's' : ''}</small></p></div><div class="table-scroll"><table class="insight-table individual-answer-table"><thead><tr><th>Proposition</th><th>Réponse de ${escapeHtml(response.name)}</th><th>Même réponse</th><th>Position</th><th>Répartition des avis</th></tr></thead><tbody>${answerRows}</tbody></table></div></section>`;
}

function renderParticipantResults() {
  const valid = responses.filter(isValidResponse);
  const ownResponse = valid.find((response) => response.id === draft.responseId);
  if (!ownResponse) return '<div class="empty-notice"><h3>Réponse introuvable</h3><p>Cette réponse n’est pas enregistrée sur ce navigateur. Connecte-toi au même appareil que celui utilisé pour le questionnaire.</p><button class="back-button" type="button" data-action="back-to-thanks">Retour</button></div>';
  const comparisons = Clustering.closestResponses(ownResponse, valid).sort((left, right) => left.score - right.score);
  const least = comparisons[0];
  const most = comparisons.at(-1);
  return `<section class="participant-results" aria-labelledby="participant-results-title"><div class="results-heading"><div><p class="section-label">Ton profil · ${escapeHtml(ownResponse.name)}</p><h3 id="participant-results-title">Les affinités évoluent.</h3></div><button class="back-button" type="button" data-action="back-to-thanks">← Retour</button></div><p class="participant-results-intro">Les groupes se recalculent à chaque nouvelle réponse enregistrée sur cet appareil ou importée par l'administration. Les noms des autres participants sont affichés au survol des points.</p>${renderClusterGraph(valid, { highlightId: ownResponse.id, revealNames: true })}<div class="participant-matches">${most ? `<p><span>Ton avis le plus proche</span><strong>${escapeHtml(most.response.name)}</strong><b>${most.score}%</b></p>` : '<p><span>Affinités</span><strong>Il faut au moins une autre réponse pour comparer.</strong></p>'}${least ? `<p><span>Ton avis le plus éloigné</span><strong>${escapeHtml(least.response.name)}</strong><b>${least.score}%</b></p>` : ''}</div><p class="participant-data-note">${valid.length} réponse${valid.length === 1 ? '' : 's'} disponible${valid.length === 1 ? '' : 's'} sur ce navigateur.</p></section>`;
}

function renderAdmin() {
  const completed = responses.filter((response) => isValidResponse(response));
  const analysis = completed.length ? summarizeGroups(completed) : null;
  const graphLabels = Object.fromEntries((analysis?.groups || []).map((group) => [group.signature, group.name]));
  const rows = completed.map((response) => {
    const comparisons = Clustering.closestResponses(response, completed).sort((left, right) => left.score - right.score);
    const least = comparisons[0];
    const most = comparisons.at(-1);
    return `<tr><th scope="row">${escapeHtml(response.name)}</th><td>${most ? `${escapeHtml(most.response.name)} <span>${most.score}%</span>` : '—'}</td><td>${least ? `${escapeHtml(least.response.name)} <span>${least.score}%</span>` : '—'}</td><td>${new Date(response.completedAt).toLocaleDateString('fr-FR')}</td></tr>`;
  }).join('');
  const individualProfiles = completed.map((response) => ({ response, stats: analyzeIndividual(response, completed) }));
  const rankedProfiles = [...individualProfiles].sort((left, right) => right.stats.majorityAnswers - left.stats.majorityAnswers || right.stats.averagePopularity - left.stats.averagePopularity);
  const mostConventional = rankedProfiles[0];
  const leastConventional = rankedProfiles.at(-1);
  const individualRows = rankedProfiles.map(({ response, stats }, index) => `
    <tr class="${response.id === selectedIndividualId ? 'is-selected' : ''}">
      <th scope="row">${index + 1}. ${escapeHtml(response.name)}</th>
      <td>${stats.majorityAnswers}/${PROPOSAL_COUNT} <small>${stats.majorityShare}%</small></td>
      <td>${stats.averagePopularity}%</td>
      <td>${escapeHtml(stats.mostConventionalAnswer.name)} <small>${stats.mostConventionalAnswer.selectedCount}/${completed.length}</small></td>
      <td>${stats.distinctiveAnswers}</td>
      <td><button class="individual-open" type="button" data-action="show-individual" data-response-id="${escapeHtml(response.id)}">Analyser</button></td>
    </tr>`).join('');
  const selectedResponse = completed.find((response) => response.id === selectedIndividualId);
  return `
    <section class="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <div class="admin-heading"><div><p class="section-label">Vue administrateur</p><h2 id="admin-dashboard-title">Les réponses <em>en commun.</em></h2></div><button class="back-button" type="button" data-action="lock-admin">Verrouiller</button></div>
      <div class="admin-warning"><span aria-hidden="true">!</span><p>${SurveyStorage.isRemote ? '<strong>Base partagée active.</strong> Les répondants voient les noms et avis nécessaires à la carte commune. Seul un compte admin autorisé peut renommer les groupes.' : '<strong>Stockage local uniquement.</strong> Ces résultats ne viennent que de ce navigateur. Les participants peuvent télécharger leur réponse pour te la transmettre, puis tu peux importer les fichiers ici.'}</p></div>
      <div class="admin-toolbar"><div class="response-total"><strong>${completed.length}</strong><span>réponse${completed.length === 1 ? '' : 's'} complète${completed.length === 1 ? '' : 's'}</span></div><div class="toolbar-actions"><button class="outline-button" type="button" data-action="export-all">Exporter les résultats</button><label class="outline-button file-button">Importer des réponses<input type="file" accept=".json,application/json" data-import-responses></label></div></div>
      <div class="results-section"><div class="results-heading"><div><p class="section-label">Carte des avis</p><h3>Les groupes qui se ressemblent</h3></div><span class="results-caption">Couleur = cluster K-means · position = projection ACP<br>Survole un point pour lire le nom</span></div>${renderClusterGraph(completed, { groupLabels: graphLabels })}</div>
      ${analysis ? `<section class="results-section insights-section"><div class="results-heading"><div><p class="section-label">Lecture des groupes</p><h3>Ce qui les rapproche et les distingue</h3></div><span class="results-caption">Signaux descriptifs, pas des explications causales</span></div><p class="insights-intro">Renomme chaque groupe. La cohésion compare toutes les paires de réponses; les signaux indiquent les propositions les plus caractéristiques de chaque groupe par rapport à l’ensemble.</p><div class="group-cards">${analysis.groups.map(renderGroupDetails).join('')}</div></section><section class="results-section differentiators-section"><div class="results-heading"><div><p class="section-label">Vue transversale</p><h3>Les propositions qui séparent le plus les groupes</h3></div><span class="results-caption">Écart entre les moyennes des groupes sur une échelle de −2 à +2</span></div>${renderDifferentiators(analysis.differentiators)}</section>` : ''}
      <div class="results-section"><div class="results-heading"><div><p class="section-label">Comparaison individuelle</p><h3>Les avis les plus proches</h3></div><span class="results-caption">Affinité calculée sur les ${PROPOSAL_COUNT} réponses</span></div><div class="table-scroll"><table class="results-table"><thead><tr><th>Participant</th><th>Plus proche</th><th>Le plus éloigné</th><th>Terminé le</th></tr></thead><tbody>${rows || '<tr><td class="no-results" colspan="4">Les réponses importées apparaîtront ici.</td></tr>'}</tbody></table></div></div>
      ${completed.length ? `<section class="results-section individual-analysis-section"><div class="results-heading"><div><p class="section-label">Profils individuels</p><h3>Conformité et réponses rares</h3></div><span class="results-caption">Une réponse rare n'est pas nécessairement meilleure ou plus juste</span></div><div class="individual-rank-cards"><article><span>Le plus souvent dans la majorité</span><strong>${escapeHtml(mostConventional.response.name)}</strong><b>${mostConventional.stats.majorityAnswers}/${PROPOSAL_COUNT} avis majoritaires</b></article><article><span>Le plus souvent minoritaire</span><strong>${escapeHtml(leastConventional.response.name)}</strong><b>${leastConventional.stats.majorityAnswers}/${PROPOSAL_COUNT} avis majoritaires</b></article></div><p class="insights-intro">« Même réponse » compare chaque choix à celui des autres répondants pour la même proposition. Le taux de majorité compte les propositions où la personne a choisi l'avis dominant; en cas d'égalité, les choix ex æquo comptent comme majoritaires.</p><div class="table-scroll"><table class="insight-table individual-ranking-table"><thead><tr><th>Participant</th><th>Choix majoritaires</th><th>Popularité moyenne</th><th>Réponse la plus partagée</th><th>Choix uniques</th><th>Détail</th></tr></thead><tbody>${individualRows}</tbody></table></div>${selectedResponse ? renderIndividualDetails(selectedResponse, completed) : '<p class="individual-hint">Sélectionne une personne pour voir ses 30 réponses, les choix des autres et ses réponses les plus courantes ou les plus rares.</p>'}</section>` : ''}
      <p id="admin-message" class="admin-message" role="status"></p>
    </section>`;
}

function isValidResponse(response) {
  return Boolean(response && typeof response.name === 'string' && response.name.trim() && Array.isArray(response.answers) && response.answers.length === PROPOSAL_COUNT && response.answers.every((answer) => Number.isInteger(Number(answer)) && Number(answer) >= -2 && Number(answer) <= 2));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function finishSurvey() {
  if (submissionPending || draft.answers.length !== PROPOSAL_COUNT || draft.answers.some((answer) => answer === undefined)) return;
  submissionPending = true;
  submissionError = '';
  render();
  const randomBytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(12));
  const recoveryCode = randomBytes
    ? [...randomBytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
    : Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
  const response = { id: createResponseId(), name: draft.name, answers: draft.answers, questionOrder: draft.order, completedAt: new Date().toISOString(), recoveryCode };
  try {
    if (SurveyStorage.isRemote) await SurveyStorage.saveResponse(response);
  } catch (error) {
    submissionPending = false;
    submissionError = `Impossible d’enregistrer ta réponse dans la base partagée. ${error.message}`;
    render();
    return;
  }
  submissionPending = false;
  draft.finished = true;
  draft.completedAt = response.completedAt;
  draft.recoveryCode = recoveryCode;
  draft.responseId = response.id;
  responses.push(response);
  if (!SurveyStorage.isRemote) saveResponses();
  saveDraft();
  render();
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }
  const answerButton = event.target.closest('[data-answer]');
  if (answerButton) {
    const questionIndex = draft.order?.[draft.index] ?? draft.index;
    draft.answers[questionIndex] = Number(answerButton.dataset.answer);
    saveDraft();
    render();
    return;
  }
  const actionTarget = event.target.closest('[data-action]');
  const action = actionTarget?.dataset.action;
  if (!action) return;
  const questionIndex = draft.order?.[draft.index] ?? draft.index;
  if (action === 'next' && draft.answers[questionIndex] !== undefined) {
    if (draft.index === PROPOSAL_COUNT - 1) finishSurvey();
    else { draft.index += 1; saveDraft(); render(); }
  } else if (action === 'back' && draft.index > 0) {
    draft.index -= 1; saveDraft(); render();
  } else if (action === 'download-mine') {
    const payload = JSON.parse(document.querySelector('#response-payload').textContent);
    downloadJson(`avis-croises-${draft.name.toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, '-')}.json`, payload);
  } else if (action === 'new-response') {
    draft = { name: '', answers: [], index: 0, started: false };
    showingMyResults = false;
    saveDraft(); render();
  } else if (action === 'view-my-results') {
    showingMyResults = true; render();
  } else if (action === 'back-to-thanks') {
    showingMyResults = false; render();
  } else if (action === 'lock-admin') {
    adminUnlocked = false;
    if (SurveyStorage.isRemote) void SurveyStorage.signOut();
    render();
  } else if (action === 'show-individual') {
    selectedIndividualId = selectedIndividualId === actionTarget.dataset.responseId ? null : actionTarget.dataset.responseId;
    render();
  } else if (action === 'close-individual') {
    selectedIndividualId = null; render();
  } else if (action === 'export-all') {
    const exportableResponses = responses.filter(isValidResponse).map(({ recoveryCode, ...response }) => response);
    downloadJson('avis-croises-resultats.json', { format: 1, proposals, groupNames, responses: exportableResponses });
  } else if (action === 'retry-storage') {
    void reloadRemoteData();
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.matches('#start-form')) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const name = formData.get('name')?.toString().trim();
    if (!name || formData.get('consent') !== 'on') return;
    draft = { name, answers: [], index: 0, order: shuffledProposalOrder(), started: true };
    saveDraft(); render();
  } else if (event.target.matches('#restore-form')) {
    event.preventDefault();
    const code = new FormData(event.target).get('recoveryCode')?.toString().trim().toUpperCase();
    let savedResponse = responses.find((response) => response.recoveryCode === code && isValidResponse(response));
    if (!savedResponse && SurveyStorage.isRemote) {
      try {
        savedResponse = await SurveyStorage.restoreResponse(code);
      } catch (error) {
        event.target.querySelector('#restore-error').textContent = error.message || 'Impossible de contacter la base partagée.';
        return;
      }
    }
    if (!savedResponse) {
      event.target.querySelector('#restore-error').textContent = SurveyStorage.isRemote
        ? 'Code inconnu. Vérifie le code retour reçu à la fin du questionnaire.'
        : 'Code inconnu sur ce navigateur. Vérifie le code ou reviens sur l’appareil utilisé pour répondre.';
      return;
    }
    draft = { name: savedResponse.name, answers: savedResponse.answers, index: PROPOSAL_COUNT - 1, started: true, finished: true, completedAt: savedResponse.completedAt, responseId: savedResponse.id, recoveryCode: savedResponse.recoveryCode || code };
    if (SurveyStorage.isRemote && !responses.some((response) => response.id === savedResponse.id)) responses.push(savedResponse);
    showingMyResults = true;
    saveDraft(); render();
  } else if (event.target.matches('#admin-form')) {
    event.preventDefault();
    if (SurveyStorage.isRemote) {
      try {
        await SurveyStorage.signIn(event.target.querySelector('#admin-email').value, event.target.querySelector('#admin-password').value);
        adminUnlocked = true;
        render();
      } catch (error) {
        event.target.querySelector('#admin-error').textContent = error.message || 'Connexion impossible.';
      }
    } else if (event.target.querySelector('#admin-code').value === config.adminCode) {
      adminUnlocked = true; render();
    } else {
      event.target.querySelector('#admin-error').textContent = 'Code incorrect.';
    }
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-group-name]')) {
    const signature = event.target.dataset.groupName;
    const fallbackName = `Groupe ${Number(event.target.getAttribute('aria-label').replace(/\D/g, '')) || 1}`;
    groupNames[signature] = event.target.value.trim() || fallbackName;
    if (SurveyStorage.isRemote) {
      try {
        await SurveyStorage.saveGroupName(signature, groupNames[signature]);
        render();
      } catch (error) {
        document.querySelector('#admin-message').textContent = error.message || 'Impossible d’enregistrer le nom du groupe.';
      }
    } else {
      saveGroupNames();
      render();
    }
    return;
  }
  if (!event.target.matches('[data-import-responses]') || !event.target.files?.[0]) return;
  const message = document.querySelector('#admin-message');
  try {
    const parsed = JSON.parse(await event.target.files[0].text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.responses || [parsed];
    const valid = incoming.filter(isValidResponse);
    if (!valid.length) throw new Error('Aucune réponse complète valide dans ce fichier.');
    const knownFingerprints = new Set(responses.map(responseFingerprint));
    const knownIds = new Set(responses.map((response) => response.id).filter(Boolean));
    const freshResponses = valid.filter((response) => {
      const fingerprint = responseFingerprint(response);
      if (knownFingerprints.has(fingerprint) || response.id && knownIds.has(response.id)) return false;
      knownFingerprints.add(fingerprint);
      if (response.id) knownIds.add(response.id);
      return true;
    }).map((response) => ({ ...response, id: response.id || createResponseId() }));
    if (SurveyStorage.isRemote) {
      for (const response of freshResponses) await SurveyStorage.saveResponse(response);
    }
    responses.push(...freshResponses);
    if (parsed.groupNames && typeof parsed.groupNames === 'object' && !Array.isArray(parsed.groupNames)) {
      groupNames = { ...groupNames, ...parsed.groupNames };
      if (SurveyStorage.isRemote) {
        for (const [signature, name] of Object.entries(parsed.groupNames)) await SurveyStorage.saveGroupName(signature, name);
      } else {
        saveGroupNames();
      }
    }
    if (!SurveyStorage.isRemote) saveResponses();
    render();
    document.querySelector('#admin-message').textContent = `${freshResponses.length} nouvelle${freshResponses.length > 1 ? 's' : ''} réponse${freshResponses.length > 1 ? 's' : ''} importée${freshResponses.length > 1 ? 's' : ''}.`;
  } catch (error) {
    if (message) message.textContent = error.message || 'Impossible de lire ce fichier.';
  }
});

document.querySelector('#proposal-count').textContent = `${proposals.length} propositions`;
document.querySelector('#storage-status').textContent = SurveyStorage.isRemote
  ? 'Réponses partagées en ligne avec les autres répondants.'
  : 'Les réponses de cette version restent dans ce navigateur.';
render();
void reloadRemoteData();