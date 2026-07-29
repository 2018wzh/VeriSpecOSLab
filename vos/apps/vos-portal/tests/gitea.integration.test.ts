import { expect,test } from "bun:test";
import { GiteaClient } from "../storage/gitea.ts";

const endpoint=process.env.PORTAL_TEST_GITEA_URL;
const integration=endpoint?test:test.skip;

integration("Gitea provisions a private repository from a template with collaborators and webhook",async()=>{
  const token=process.env.PORTAL_TEST_GITEA_TOKEN!;
  const username=process.env.PORTAL_TEST_GITEA_USERNAME!;
  const suffix=crypto.randomUUID().slice(0,8);
  const template=`template-${suffix}`;
  const organization=`course-${suffix}`;
  const repository=`team-${suffix}`;
  const request=async(pathname:string,init:RequestInit={})=>{const response=await fetch(new URL(pathname,`${endpoint!.replace(/\/$/,"")}/`),{...init,headers:{authorization:`token ${token}`,accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...init.headers}});if(!response.ok)throw new Error(`Gitea integration HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);return response;};
  try{
    await request("/api/v1/user/repos",{method:"POST",body:JSON.stringify({name:template,description:"VOS integration template",private:true,template:true,auto_init:true})});
    await request("/api/v1/orgs",{method:"POST",body:JSON.stringify({username:organization,full_name:"VOS integration course",visibility:"private"})});
    const provisioned=await new GiteaClient(endpoint!,token).provision({owner:organization,name:repository,template_owner:username,template_repo:template,description:"VOS integration team",private:true,collaborators:[username],webhook_url:"http://vos-portal:8787/api/v1/internal/gitea/webhook",webhook_secret:"integration-webhook-secret"});
    expect(provisioned.full_name).toBe(`${organization}/${repository}`);
    expect((await request(`/api/v1/repos/${organization}/${repository}/collaborators/${username}/permission`)).status).toBe(200);
    const hooks=await (await request(`/api/v1/repos/${organization}/${repository}/hooks`)).json() as Array<{config?:{url?:string}}>;
    expect(hooks.some(hook=>hook.config?.url==="http://vos-portal:8787/api/v1/internal/gitea/webhook")).toBe(true);
    expect((await new GiteaClient(endpoint!,token).provision({owner:organization,name:repository,template_owner:username,template_repo:template,description:"VOS integration team",private:true,collaborators:[username],webhook_url:"http://vos-portal:8787/api/v1/internal/gitea/webhook",webhook_secret:"integration-webhook-secret"})).id).toBe(provisioned.id);
  }finally{
    await request(`/api/v1/repos/${organization}/${repository}`,{method:"DELETE"}).catch(()=>undefined);
    await request(`/api/v1/orgs/${organization}`,{method:"DELETE"}).catch(()=>undefined);
    await request(`/api/v1/repos/${username}/${template}`,{method:"DELETE"}).catch(()=>undefined);
  }
},30_000);
