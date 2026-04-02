export async function upsertUserStore(db, data) {
  const stmt = db.prepare(`
    INSERT INTO user_store (marca_user, ip, user_agent, fbp, fbc, ttp, ttclid,
      ga_client_id, ga_session_id, ga_session_count, ga_timestamp,
      page_url, email, phone, fullname, city, state, country, zip)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
    ON CONFLICT(marca_user) DO UPDATE SET
      updated_at       = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      ip               = COALESCE(NULLIF(excluded.ip, ''),               user_store.ip),
      user_agent       = COALESCE(NULLIF(excluded.user_agent, ''),       user_store.user_agent),
      fbp              = COALESCE(NULLIF(excluded.fbp, ''),              user_store.fbp),
      fbc              = COALESCE(NULLIF(excluded.fbc, ''),              user_store.fbc),
      ttp              = COALESCE(NULLIF(excluded.ttp, ''),              user_store.ttp),
      ttclid           = COALESCE(NULLIF(excluded.ttclid, ''),           user_store.ttclid),
      ga_client_id     = COALESCE(NULLIF(excluded.ga_client_id, ''),     user_store.ga_client_id),
      ga_session_id    = COALESCE(NULLIF(excluded.ga_session_id, ''),    user_store.ga_session_id),
      ga_session_count = COALESCE(NULLIF(excluded.ga_session_count, ''), user_store.ga_session_count),
      ga_timestamp     = COALESCE(NULLIF(excluded.ga_timestamp, ''),     user_store.ga_timestamp),
      page_url         = COALESCE(NULLIF(excluded.page_url, ''),         user_store.page_url),
      email            = COALESCE(NULLIF(excluded.email, ''),            user_store.email),
      phone            = COALESCE(NULLIF(excluded.phone, ''),            user_store.phone),
      fullname         = COALESCE(NULLIF(excluded.fullname, ''),         user_store.fullname),
      city             = COALESCE(NULLIF(excluded.city, ''),             user_store.city),
      state            = COALESCE(NULLIF(excluded.state, ''),            user_store.state),
      country          = COALESCE(NULLIF(excluded.country, ''),          user_store.country),
      zip              = COALESCE(NULLIF(excluded.zip, ''),              user_store.zip)
  `);

  return stmt.bind(
    data.marca_user,
    data.ip || '',
    data.user_agent || '',
    data.fbp || '',
    data.fbc || '',
    data.ttp || '',
    data.ttclid || '',
    data.ga_client_id || '',
    data.ga_session_id || '',
    data.ga_session_count || '',
    data.ga_timestamp || '',
    data.page_url || '',
    data.email || '',
    data.phone || '',
    data.fullname || '',
    data.city || '',
    data.state || '',
    data.country || '',
    data.zip || ''
  ).run();
}

export async function getUserStore(db, marcaUser) {
  return db.prepare('SELECT * FROM user_store WHERE marca_user = ?').bind(marcaUser).first();
}
