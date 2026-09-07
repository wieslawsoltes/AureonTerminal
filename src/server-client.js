/** Same-origin API client. Broker credentials never enter browser storage. */
export class ServerClient extends EventTarget {
  constructor(){super();this.csrf=null;this.profile=null;this.revisions=new Map();}
  async request(path,{method='GET',body,revision,signal}={}){const headers={'Accept':'application/json'};if(body!==undefined)headers['Content-Type']='application/json';if(this.csrf)headers['X-CSRF-Token']=this.csrf;if(revision!=null)headers['If-Match']=String(revision);const response=await fetch('./v2/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',signal:signal||AbortSignal.timeout(15000)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw new Error('Server features require the included Node server, not static-only hosting.');}if(!response.ok)throw new Error(data.error||`Server HTTP ${response.status}`);return data;}
  async session(){const profile=await this.request('session');this.profile=profile;this.csrf=profile.csrf;return profile;}
  async login(username,password,register=false,code=''){await this.request(register?'register':'login',{method:'POST',body:{username,password,code}});return this.session();}
  async logout(){await this.request('logout',{method:'POST',body:{}});this.closeEvents();this.csrf=null;this.profile=null;}
  events(){this.closeEvents();this.stream=new EventSource('./v2/events');this.stream.onmessage=e=>{try{this.dispatchEvent(new CustomEvent('event',{detail:JSON.parse(e.data)}));}catch{}};return this.stream;}
  closeEvents(){this.stream?.close();this.stream=null;}
}
