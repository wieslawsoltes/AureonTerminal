export const $=id=>document.getElementById(id);
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=(v,d=2)=>Number.isFinite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v):v===Infinity?'∞':'—';
export const percent=v=>`${v>=0?'+':''}${number(v)}%`;
export const select=(name,values,value,extra='')=>`<select name="${escapeHTML(name)}" ${extra}>${values.map(x=>{const [key,label]=Array.isArray(x)?x:[x,x];return`<option value="${escapeHTML(key)}" ${String(key)===String(value)?'selected':''}>${escapeHTML(label)}</option>`;}).join('')}</select>`;
export const field=(label,input)=>`<label class="v2-field"><span>${escapeHTML(label)}</span>${input}</label>`;
export const input=(name,value,type='number',extra='')=>`<input name="${escapeHTML(name)}" type="${type}" value="${escapeHTML(value)}" ${extra}>`;
export const button=(label,action,extra='')=>`<button class="secondary-button" data-v2="${escapeHTML(action)}" ${extra}>${escapeHTML(label)}</button>`;
export const empty=text=>`<div class="empty-state"><p>${escapeHTML(text)}</p></div>`;
export const note=text=>`<p class="small-note">${escapeHTML(text)}</p>`;
export const table=(headers,rows)=>`<div class="table-scroll"><table class="report-table"><thead><tr>${headers.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
export function safeURL(raw){try{const u=new URL(raw);return['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
