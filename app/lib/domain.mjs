import { readFile } from 'node:fs/promises';

export async function loadLibrary(path) {
  const text = await readFile(path, 'utf8');
  const match = text.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!match) throw new Error('В инструкции не найден справочник JSON');
  return { config: JSON.parse(match[1]), rules: text.slice(0, text.indexOf('## Данные')) };
}
export function halfMean(values) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (!valid.length) return null;
  if (valid.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 3 || !Number.isInteger(v * 2))) throw new Error('Некорректная оценка');
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 2) / 2;
}
export function route(config, topic, profileId, scenarioId) {
  const profile = config.job_profiles.find(p => p.id === profileId);
  const scenario = config.scenarios.find(s => s.id === scenarioId);
  if (!profile || !scenario || scenario.topic !== topic) throw new Error('Проверьте тему, должность и сценарий');
  const mapping = config.scenario_competency_map.find(m => m.scenario_id === scenarioId);
  const manager = ['Топ-менеджмент', 'Руководитель отдела', 'Руководитель группы / заместитель'].includes(profile.job_level);
  const permitted = mapping.scope === 'any' || manager ||
    (mapping.scope === 'manager_or_mentor' && Object.hasOwn(profile.targets, '65')) ||
    (mapping.scope === 'project_owner' && profile.family === 'Управление проектами');
  const ids = mapping.competency_ids.filter(id => Object.hasOwn(profile.targets, String(id)));
  if (!permitted || !ids.length) throw new Error('Этот сценарий не соответствует профилю должности');
  const competencies = ids.map(id => {
    const item = config.competency_dictionary.find(c => c.id === id);
    const focus = config.episode_operationalization.find(c => c.competency_id === id);
    return { id, name: item.name, target: profile.targets[String(id)], levels: item.levels,
      focus: focus.episode_focus_by_target, limits: focus.requires_workplace_evidence };
  });
  return { profile, scenario, competencies };
}
export function publicScenario(s, competencies) {
  return { id:s.id, title:s.title, topic:s.topic, level:s.level, mode:s.mode,
    brief:s.brief, character:s.character, competencies:competencies.map(({id,name,target})=>({id,name,target})) };
}
export function availableScenarios(config, topic, profileId) {
  return config.scenarios.filter(s => s.topic === topic).flatMap(s => {
    try { const ctx = route(config, topic, profileId, s.id); return [publicScenario(s, ctx.competencies)]; }
    catch { return []; }
  });
}
export function publicCatalog(config) {
  return { topics:config.ui.topic_selector.options, profileVersion:config.profile_version,
    profiles:config.job_profiles.map(p=>({id:p.id,title:p.title,family:p.family,job_level:p.job_level,
      aliases:p.aliases,competencies:Object.entries(p.targets).map(([id,target])=>({id:Number(id),target,
        name:config.competency_dictionary.find(c=>c.id===Number(id)).name}))})) };
}
export function nextMonth(localDate) {
  const [y,m] = localDate.split('-').map(Number);
  const year = m === 12 ? y + 1 : y, month = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(year,month,0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2,'0')}-`;
  const date = day => prefix+String(day).padStart(2,'0');
  return {start:date(1),end:date(last),weeks:[[1,7],[8,14],[15,21],[22,last]].map(([a,b])=>({start:date(a),end:date(b)}))};
}
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function validateScores(rows, competencies, messages, requireAll = false) {
  if (!Array.isArray(rows)) throw new Error('Не получены оценки компетенций');
  const allowed = new Set(competencies.map(c=>c.id)), seen = new Set();
  for (const row of rows) {
    if (!allowed.has(row.id) || seen.has(row.id)) throw new Error('Оценка за пределами профиля');
    seen.add(row.id); halfMean([row.score]);
    if (row.score !== null && row.score !== undefined && row.score > 0 && (!row.quote || !messages.some(m=>m.includes(row.quote)))) throw new Error('Оценка не подтверждена цитатой участника');
    if (row.quote && !messages.some(m=>m.includes(row.quote))) throw new Error('Цитата отсутствует в диалоге');
    if (row.score === undefined) throw new Error('В оценке отсутствует значение');
  }
  if (requireAll && seen.size !== allowed.size) throw new Error('Не все активные компетенции учтены');
  return rows;
}
