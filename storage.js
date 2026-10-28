(() => {
  const config = window.SURVEY_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const client = configured && window.supabase?.createClient
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

  function requireClient() {
    if (!client) throw new Error('La bibliothèque Supabase n’a pas pu être chargée. Vérifie ta connexion internet puis réessaie.');
    return client;
  }

  async function recoveryHash(code) {
    const bytes = new TextEncoder().encode(code.trim().toUpperCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function fromDatabase(row) {
    return {
      id: row.id,
      name: row.name,
      answers: row.answers.map(Number),
      questionOrder: (row.question_order || []).map(Number),
      completedAt: row.completed_at,
    };
  }

  function throwIfError(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  window.SurveyStorage = {
    isRemote: configured,
    async loadResponses() {
      if (!configured) return [];
      const data = throwIfError(await requireClient().from('responses').select('id,name,answers,question_order,completed_at').order('completed_at'));
      return data.map(fromDatabase);
    },
    async saveResponse(response) {
      if (!configured) return;
      const tokenHash = response.recoveryCode ? await recoveryHash(response.recoveryCode) : null;
      throwIfError(await requireClient().rpc('submit_survey_response', {
        p_id: response.id,
        p_name: response.name,
        p_answers: response.answers,
        p_question_order: response.questionOrder || Array.from({ length: 30 }, (_, index) => index),
        p_recovery_hash: tokenHash,
      }));
    },
    async restoreResponse(code) {
      if (!configured) return null;
      const tokenHash = await recoveryHash(code);
      const rows = throwIfError(await requireClient().rpc('restore_survey_response', { p_recovery_hash: tokenHash }));
      return rows?.[0] ? fromDatabase(rows[0]) : null;
    },
    async loadGroupNames() {
      if (!configured) return {};
      const rows = throwIfError(await requireClient().from('group_names').select('signature,name'));
      return Object.fromEntries(rows.map((row) => [row.signature, row.name]));
    },
    async saveGroupName(signature, name) {
      if (!configured) return;
      throwIfError(await requireClient().from('group_names').upsert({ signature, name }, { onConflict: 'signature' }));
    },
    async signIn(email, password) {
      throwIfError(await requireClient().auth.signInWithPassword({ email, password }));
      const isAdmin = throwIfError(await requireClient().rpc('is_survey_admin'));
      if (!isAdmin) {
        await requireClient().auth.signOut();
        throw new Error('Ce compte n’a pas les droits administrateur du questionnaire.');
      }
    },
    async signOut() {
      if (client) await client.auth.signOut();
    },
  };
})();