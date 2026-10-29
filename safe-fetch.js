'use strict';
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
function publicAddress(value) { try { let a=ipaddr.parse(value); if(a.kind()==='ipv6' && a.isIPv4MappedAddress())a=a.toIPv4Address();return a.range()==='unicast'; } catch{return false;} }
async function safeFetch(raw, opts={}) {
  let u=new URL(raw);
  for(let i=0;i<6;i++) {
    if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443')) throw Error('Unsafe media URL');
    const host=u.hostname.replace(/^\[|\]$/g,'');
    const answers=await dns.lookup(host,{all:true});
    if(!answers.length || answers.some(a=>!publicAddress(a.address)))throw Error('Non-public address');
    const r=await fetch(u,{...opts,redirect:'manual'});
    if([301,302,303,307,308].includes(r.status)) {const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('Bad redirect');const target=new URL(next,u);if(target.origin!==u.origin&&opts.headers){const h=new Headers(opts.headers);for(const k of ['authorization','cookie','proxy-authorization','x-rapidapi-key','x-api-key'])h.delete(k);opts={...opts,headers:Object.fromEntries(h)};}u=target;continue;}
    return r;
  }
  throw Error('Too many redirects');
}
module.exports={safeFetch,publicAddress};
