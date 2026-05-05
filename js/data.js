// ============================================================
// DATA LAYER — localStorage avec structure audit complète
// ============================================================

const DB = {
  // Clés localStorage
  KEYS: {
    USERS: 'sh_users',
    SITES: 'sh_sites',
    EMPLOYEES: 'sh_employees',
    POINTAGE: 'sh_pointage',
    AUDIT: 'sh_audit',
    LOCKS: 'sh_locks',
    HOLIDAYS: 'sh_holidays',
    SESSION: 'sh_session',
  },

  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  },
  getObj(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  // --- INITIALISATION DES DONNÉES PAR DÉFAUT ---
  init() {
    if (this.get(this.KEYS.USERS).length === 0) {
      this.set(this.KEYS.USERS, [
        { id: 'u1', username: 'admin', password: 'stayhere2024', role: 'cluster_ops', nom: 'Cluster Ops Manager', site: null },
        { id: 'u2', username: 'juriste', password: 'juriste2024', role: 'juriste', nom: 'Juriste', site: null },
        { id: 'u3', username: 'finance', password: 'finance2024', role: 'responsable_financier', nom: 'Responsable Financier', site: null },
        { id: 'u4', username: 'ka_casa', password: 'ka2024', role: 'kindness_ambassador', nom: 'KA Casablanca', site: 'site_casa' },
        { id: 'u5', username: 'ka_rabat', password: 'ka2024', role: 'kindness_ambassador', nom: 'KA Rabat', site: 'site_rabat' },
      ]);
    }
    if (this.get(this.KEYS.SITES).length === 0) {
      this.set(this.KEYS.SITES, [
        { id: 'site_casa', nom: 'Casablanca', ville: 'Casablanca', actif: true },
        { id: 'site_rabat', nom: 'Rabat', ville: 'Rabat', actif: true },
        { id: 'site_agadir', nom: 'Agadir', ville: 'Agadir', actif: true },
        { id: 'site_office', nom: 'Office / Siège', ville: 'Casablanca', actif: true },
      ]);
    }
    // Affectations (sous-sites)
    if (!localStorage.getItem('sh_affectations')) {
      localStorage.setItem('sh_affectations', JSON.stringify([
        'Gauthier 1', 'Gauthier 2', 'Gauthier 3',
        'Maarif', 'Cil', 'Palmier', 'Oasis',
        'Agdal 1', 'Agdal 2', 'Agdal 3', 'Agdal 4',
        'Hassan', 'Hay Riad',
        'Agadir',
      ]));
    }
    if (this.get(this.KEYS.EMPLOYEES).length === 0) {
      this.set(this.KEYS.EMPLOYEES, [
        { id: 'e1', imm: '123', nom: 'Jafri', prenom: 'Aimane', site: 'site_casa', affectation: 'Oasis', poste: 'Kindness Ambassador', actif: true },
        { id: 'e2', imm: '147', nom: 'Ksimi', prenom: 'Nabil', site: 'site_casa', affectation: 'Gauthier 1', poste: 'Kindness Ambassador', actif: true },
        { id: 'e3', imm: '164', nom: 'Ait Benothmane', prenom: 'Salma', site: 'site_casa', affectation: 'Gauthier 2', poste: 'Kindness Ambassador', actif: true },
        { id: 'e4', imm: '191', nom: 'El Qasmi', prenom: 'Mouad', site: 'site_casa', affectation: 'Oasis', poste: 'Kindness Host', actif: true },
        { id: 'e5', imm: '94', nom: 'Kafay', prenom: 'Mourad', site: 'site_agadir', affectation: 'Agadir', poste: 'Kindness Ambassador', actif: true },
      ]);
    }
    if (this.get(this.KEYS.HOLIDAYS).length === 0) {
      this.set(this.KEYS.HOLIDAYS, [
        { date: '2026-01-01', nom: 'Nouvel An' },
        { date: '2026-01-11', nom: 'Manifeste de l\'Indépendance' },
        { date: '2026-03-03', nom: 'Fête du Trône' },
        { date: '2026-05-01', nom: 'Fête du Travail' },
        { date: '2026-07-30', nom: 'Fête du Trône' },
        { date: '2026-08-14', nom: 'Allégeance Oued Eddahab' },
        { date: '2026-08-20', nom: 'Révolution du Roi' },
        { date: '2026-08-21', nom: 'Fête de la Jeunesse' },
        { date: '2026-11-06', nom: 'Marche Verte' },
        { date: '2026-11-18', nom: 'Fête de l\'Indépendance' },
      ]);
    }
  },

  // --- UTILISATEURS ---
  getUsers() { return this.get(this.KEYS.USERS); },
  getUserByCredentials(username, password) {
    return this.getUsers().find(u => u.username === username && u.password === password) || null;
  },
  updateUserPassword(userId, newPassword) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx >= 0) { users[idx].password = newPassword; this.set(this.KEYS.USERS, users); }
  },
  addUser(user) {
    const users = this.getUsers();
    user.id = 'u' + Date.now();
    users.push(user);
    this.set(this.KEYS.USERS, users);
    return user;
  },
  deleteUser(userId) {
    const users = this.getUsers().filter(u => u.id !== userId);
    this.set(this.KEYS.USERS, users);
  },

  // --- SESSION ---
  getSession() { return this.getObj(this.KEYS.SESSION); },
  setSession(user) { this.set(this.KEYS.SESSION, { ...user, loginAt: new Date().toISOString() }); },
  clearSession() { localStorage.removeItem(this.KEYS.SESSION); },

  // --- AFFECTATIONS ---
  getAffectations() {
    try { return JSON.parse(localStorage.getItem('sh_affectations')) || []; } catch { return []; }
  },
  addAffectation(nom) {
    const list = this.getAffectations();
    if (!list.includes(nom)) { list.push(nom); localStorage.setItem('sh_affectations', JSON.stringify(list)); }
  },

  // --- SITES ---
  getSites() { return this.get(this.KEYS.SITES); },
  getSiteById(id) { return this.getSites().find(s => s.id === id); },
  addSite(site) {
    const sites = this.getSites();
    site.id = 'site_' + Date.now();
    site.actif = true;
    sites.push(site);
    this.set(this.KEYS.SITES, sites);
    return site;
  },
  updateSite(id, updates) {
    const sites = this.getSites();
    const idx = sites.findIndex(s => s.id === id);
    if (idx >= 0) { sites[idx] = { ...sites[idx], ...updates }; this.set(this.KEYS.SITES, sites); }
  },

  // --- COLLABORATEURS ---
  getEmployees(siteId = null) {
    const emps = this.get(this.KEYS.EMPLOYEES);
    return siteId ? emps.filter(e => e.site === siteId) : emps;
  },
  addEmployee(emp) {
    const emps = this.getEmployees();
    emp.id = 'e' + Date.now();
    emp.actif = true;
    emps.push(emp);
    this.set(this.KEYS.EMPLOYEES, emps);
    return emp;
  },
  updateEmployee(id, updates) {
    const emps = this.get(this.KEYS.EMPLOYEES);
    const idx = emps.findIndex(e => e.id === id);
    if (idx >= 0) { emps[idx] = { ...emps[idx], ...updates }; this.set(this.KEYS.EMPLOYEES, emps); }
  },
  deleteEmployee(id) {
    const emps = this.get(this.KEYS.EMPLOYEES).filter(e => e.id !== id);
    this.set(this.KEYS.EMPLOYEES, emps);
  },

  // --- POINTAGE ---
  getPointage(siteId = null, year = null, month = null) {
    let entries = this.get(this.KEYS.POINTAGE);
    if (siteId) entries = entries.filter(p => p.site === siteId);
    if (year !== null) entries = entries.filter(p => p.date.startsWith(`${year}-`));
    if (month !== null) {
      const m = String(month).padStart(2, '0');
      entries = entries.filter(p => p.date.startsWith(`${year}-${m}`));
    }
    return entries;
  },
  getPointageByEmployeeDate(empId, date) {
    return this.get(this.KEYS.POINTAGE).find(p => p.employee_id === empId && p.date === date) || null;
  },
  setPointage(empId, date, type, notes, userSession) {
    const allPointage = this.get(this.KEYS.POINTAGE);
    const emp = this.get(this.KEYS.EMPLOYEES).find(e => e.id === empId);
    if (!emp) return null;

    // Vérifier verrou
    const lock = this.getLock(emp.site, date.substring(0, 7));
    if (lock) throw new Error(`Mois ${date.substring(0, 7)} verrouillé.`);

    const existing = allPointage.find(p => p.employee_id === empId && p.date === date);
    const now = new Date().toISOString();

    if (existing) {
      const oldType = existing.type;
      existing.type = type;
      existing.notes = notes || '';
      existing.updated_by = userSession.username;
      existing.updated_at = now;
      this.set(this.KEYS.POINTAGE, allPointage);
      this.addAudit('update', existing.id, userSession.username, { type: oldType }, { type }, emp.site);
      return existing;
    } else {
      const entry = {
        id: 'p' + Date.now() + Math.random().toString(36).substr(2, 5),
        employee_id: empId,
        site: emp.site,
        date,
        type,
        notes: notes || '',
        created_by: userSession.username,
        created_at: now,
        updated_by: null,
        updated_at: null,
        validated: false,
        validated_by: null,
        validated_at: null,
      };
      allPointage.push(entry);
      this.set(this.KEYS.POINTAGE, allPointage);
      this.addAudit('create', entry.id, userSession.username, null, { type }, emp.site);
      return entry;
    }
  },
  validateEntry(entryId, userSession) {
    const allPointage = this.get(this.KEYS.POINTAGE);
    const idx = allPointage.findIndex(p => p.id === entryId);
    if (idx >= 0) {
      allPointage[idx].validated = true;
      allPointage[idx].validated_by = userSession.username;
      allPointage[idx].validated_at = new Date().toISOString();
      this.set(this.KEYS.POINTAGE, allPointage);
      this.addAudit('validate', entryId, userSession.username, null, null, allPointage[idx].site);
    }
  },
  deletePointage(empId, date, userSession) {
    const allPointage = this.get(this.KEYS.POINTAGE);
    const emp = this.get(this.KEYS.EMPLOYEES).find(e => e.id === empId);
    const lock = this.getLock(emp?.site, date.substring(0, 7));
    if (lock) throw new Error(`Mois verrouillé.`);
    const entry = allPointage.find(p => p.employee_id === empId && p.date === date);
    if (entry) {
      this.addAudit('delete', entry.id, userSession.username, { type: entry.type }, null, entry.site);
      this.set(this.KEYS.POINTAGE, allPointage.filter(p => !(p.employee_id === empId && p.date === date)));
    }
  },

  // --- VERROUS ---
  getLocks() { return this.get(this.KEYS.LOCKS); },
  getLock(siteId, yearMonth) {
    return this.getLocks().find(l => l.site === siteId && l.yearMonth === yearMonth) || null;
  },
  addLock(siteId, yearMonth, userSession) {
    const locks = this.getLocks();
    if (!this.getLock(siteId, yearMonth)) {
      locks.push({ site: siteId, yearMonth, locked_by: userSession.username, locked_at: new Date().toISOString() });
      this.set(this.KEYS.LOCKS, locks);
      this.addAudit('lock', yearMonth, userSession.username, null, { siteId, yearMonth }, siteId);
    }
  },
  removeLock(siteId, yearMonth, userSession) {
    const locks = this.getLocks().filter(l => !(l.site === siteId && l.yearMonth === yearMonth));
    this.set(this.KEYS.LOCKS, locks);
    this.addAudit('unlock', yearMonth, userSession.username, null, { siteId, yearMonth }, siteId);
  },

  // --- JOURS FÉRIÉS ---
  getHolidays() { return this.get(this.KEYS.HOLIDAYS); },
  isHoliday(date) { return this.getHolidays().some(h => h.date === date); },
  getHolidayName(date) { return this.getHolidays().find(h => h.date === date)?.nom || null; },
  addHoliday(date, nom) {
    const h = this.getHolidays();
    if (!h.find(x => x.date === date)) { h.push({ date, nom }); this.set(this.KEYS.HOLIDAYS, h); }
  },
  removeHoliday(date) {
    this.set(this.KEYS.HOLIDAYS, this.getHolidays().filter(h => h.date !== date));
  },

  // --- AUDIT ---
  addAudit(action, entryId, username, oldVal, newVal, site) {
    const log = this.get(this.KEYS.AUDIT);
    log.push({
      id: 'a' + Date.now(),
      action,
      entry_id: entryId,
      username,
      site,
      old_value: oldVal,
      new_value: newVal,
      timestamp: new Date().toISOString(),
    });
    this.set(this.KEYS.AUDIT, log);
  },
  getAudit(siteId = null) {
    const log = this.get(this.KEYS.AUDIT);
    return siteId ? log.filter(a => a.site === siteId) : log;
  },

  // --- SYNTHÈSE ---
  getSynthese(siteId, year, month) {
    const entries = this.getPointage(siteId, year, month);
    const emps = this.getEmployees(siteId).filter(e => e.actif);
    const result = {};
    const types = ['travaille', 'off', 'maladie', 'conge', 'recup', 'depart', 'absence', 'at', 'ferie', 'aj', 'nvrecru', 'standby'];

    emps.forEach(emp => {
      result[emp.id] = { emp, totals: {} };
      types.forEach(t => {
        result[emp.id].totals[t] = entries.filter(p => p.employee_id === emp.id && p.type === t).length;
      });
    });
    return result;
  },

  // Export CSV
  exportCSV(siteId, year, month) {
    const entries = this.getPointage(siteId, year, month);
    const emps = this.getEmployees(siteId);
    const site = this.getSiteById(siteId);

    const TYPE_CODES = {
      travaille: '1', off: 'OFF', maladie: 'M', conge: 'C', recup: 'R',
      depart: 'D', absence: 'A', at: 'AT', ferie: 'F', aj: 'AJ',
      nvrecru: 'NV RECRU', standby: 'STAND BY',
    };

    let csv = `N° IMM;Site;Affectation;Collaborateur;Poste;Date;Code;Type;Notes;Saisi par;Validé\n`;
    entries.forEach(p => {
      const emp = emps.find(e => e.id === p.employee_id);
      if (!emp) return;
      const code = TYPE_CODES[p.type] || p.type;
      csv += `"${emp.imm || ''}";"${site?.nom || siteId}";"${emp.affectation || ''}";"${emp.nom} ${emp.prenom}";"${emp.poste}";"${p.date}";"${code}";"${p.type}";"${p.notes}";"${p.created_by}";"${p.validated ? 'Oui' : 'Non'}"\n`;
    });
    return csv;
  },
};
