const SUBJECTS = [
  "BIOLOGY","CHEMISTRY","CRE","ENGLISH","GEOGRAPHY",
  "HISTORY","ICT","MATHEMATICS","PHYSICS"
];

let supabaseClient;
let currentUser = null;
let sharedToken = null;

function grade(mark){
  if(mark === null || mark === "" || Number.isNaN(Number(mark))) return "-";
  mark = Number(mark);
  if(mark >= 80) return "A";
  if(mark >= 70) return "B";
  if(mark >= 60) return "C";
  if(mark >= 50) return "D";
  if(mark >= 40) return "E";
  return "F";
}

function showMessage(id, text, good=true){
  const el=document.getElementById(id);
  el.textContent=text;
  el.style.color=good ? "#18794e" : "#b42318";
}

function buildMarksTable(){
  const body=document.getElementById("marksBody");
  body.innerHTML="";
  SUBJECTS.forEach(subject=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${subject}</td>
      <td><input class="mark-input mark" data-subject="${subject}" type="number" min="0" max="100" placeholder="0-100"></td>
      <td class="grade">-</td>`;
    body.appendChild(tr);
  });
  document.querySelectorAll(".mark").forEach(i=>i.addEventListener("input",calculate));
}

function calculate(){
  let total=0,count=0;
  document.querySelectorAll(".mark").forEach(input=>{
    let v=input.value;
    if(v!==""){
      v=Math.max(0,Math.min(100,Number(v)));
      input.value=v;
      total+=v; count++;
    }
    input.closest("tr").querySelector(".grade").textContent=grade(v);
  });
  const avg=count ? total/count : 0;
  document.getElementById("total").textContent=total;
  document.getElementById("average").textContent=avg.toFixed(1)+"%";
  document.getElementById("overall").textContent=count ? grade(avg) : "-";
  return {total,avg};
}

async function init(){
  if(!window.SUPABASE_URL || window.SUPABASE_URL.includes("PASTE_")){
    showMessage("authMessage","Open config.js and add your Supabase Project URL and public key.",false);
    return;
  }
  supabaseClient = window.supabase.createClient(
    window.SUPABASE_URL, window.SUPABASE_ANON_KEY
  );

  const params=new URLSearchParams(location.search);
  sharedToken=params.get("share");
  if(sharedToken){
    await loadShared(sharedToken);
    return;
  }

  document.getElementById("loginTab").onclick=()=>setAuthMode(false);
  document.getElementById("signupTab").onclick=()=>setAuthMode(true);
  document.getElementById("authForm").addEventListener("submit",handleAuth);
  document.getElementById("logoutBtn").onclick=logout;
  document.getElementById("saveProfileBtn").onclick=saveProfile;
  document.getElementById("saveMarksBtn").onclick=saveMarks;
  document.getElementById("shareBtn").onclick=createShare;
  buildMarksTable();

  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session) await loadDashboard(session.user);
  else showAuth();
}

function setAuthMode(signup){
  document.getElementById("nameWrap").classList.toggle("hidden",!signup);
  document.getElementById("authBtn").textContent=signup ? "Create account":"Log in";
  document.getElementById("loginTab").classList.toggle("active",!signup);
  document.getElementById("signupTab").classList.toggle("active",signup);
}

function showAuth(){
  document.getElementById("authSection").classList.remove("hidden");
  document.getElementById("dashboardSection").classList.add("hidden");
  document.getElementById("logoutBtn").classList.add("hidden");
}

async function handleAuth(e){
  e.preventDefault();
  const email=document.getElementById("email").value.trim();
  const password=document.getElementById("password").value;
  const signup=!document.getElementById("nameWrap").classList.contains("hidden");
  showMessage("authMessage","Please wait...",true);

  if(signup){
    const name=document.getElementById("name").value.trim();
    if(!name){showMessage("authMessage","Enter your name.",false);return;}
    const {data,error}=await supabaseClient.auth.signUp({
      email,password,options:{data:{full_name:name}}
    });
    if(error){showMessage("authMessage",error.message,false);return;}
    if(data.user){
      if(data.session) await loadDashboard(data.user);
      else showMessage("authMessage","Account created. Check your email if email confirmation is enabled.");
    }
  }else{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error){showMessage("authMessage",error.message,false);return;}
    await loadDashboard(data.user);
  }
}

async function loadDashboard(user){
  currentUser=user;
  document.getElementById("authSection").classList.add("hidden");
  document.getElementById("dashboardSection").classList.remove("hidden");
  document.getElementById("logoutBtn").classList.remove("hidden");
  document.getElementById("profileEmail").value=user.email||"";

  let {data:learner,error}=await supabaseClient
    .from("learners").select("*").eq("id",user.id).maybeSingle();

  if(error){showMessage("dashboardMessage",error.message,false);return;}

  if(!learner){
    const name=user.user_metadata?.full_name || "";
    const result=await supabaseClient.from("learners").insert({id:user.id,name}).select().single();
    if(result.error){showMessage("dashboardMessage",result.error.message,false);return;}
    learner=result.data;
  }

  document.getElementById("profileName").value=learner.name||"";
  document.getElementById("welcomeName").textContent=learner.name || "Learner";

  const {data:marks,error:marksError}=await supabaseClient
    .from("marks").select("subject,mark").eq("learner_id",user.id);

  if(marksError){showMessage("dashboardMessage",marksError.message,false);return;}

  const map={};
  (marks||[]).forEach(m=>map[m.subject]=m.mark);
  document.querySelectorAll(".mark").forEach(input=>{
    input.value=map[input.dataset.subject] ?? "";
  });
  calculate();
  await loadOwnerComments();
}

async function saveProfile(){
  const name=document.getElementById("profileName").value.trim();
  if(!name){showMessage("dashboardMessage","Enter your name.",false);return;}
  const {error}=await supabaseClient.from("learners").update({name}).eq("id",currentUser.id);
  if(error){showMessage("dashboardMessage",error.message,false);return;}
  document.getElementById("welcomeName").textContent=name;
  showMessage("dashboardMessage","Name saved.");
}

async function saveMarks(){
  const rows=[...document.querySelectorAll(".mark")].map(input=>({
    learner_id:currentUser.id,
    subject:input.dataset.subject,
    mark:input.value==="" ? null : Number(input.value)
  }));
  const {error}=await supabaseClient.from("marks").upsert(rows,{onConflict:"learner_id,subject"});
  if(error){showMessage("dashboardMessage",error.message,false);return;}
  calculate();
  showMessage("dashboardMessage","Marks saved successfully.");
}

async function createShare(){
  const {data,error}=await supabaseClient.rpc("create_share_token");
  if(error){showMessage("dashboardMessage",error.message,false);return;}
  const token=data;
  const link=location.origin+location.pathname+"?share="+encodeURIComponent(token);
  document.getElementById("shareLink").value=link;
  try{await navigator.clipboard.writeText(link);}catch(_){}
  showMessage("dashboardMessage","Share link created and copied when your browser allows it.");
}

async function loadShared(token){
  document.getElementById("authSection").classList.add("hidden");
  document.getElementById("dashboardSection").classList.add("hidden");
  document.getElementById("sharedSection").classList.remove("hidden");

  const {data:result,error}=await supabaseClient.rpc("get_shared_result",{p_token:token});
  if(error || !result){document.getElementById("sharedName").textContent="Result not found";return;}

  document.getElementById("sharedName").textContent=result.name || "Learner Results";
  const body=document.getElementById("sharedMarksBody");
  body.innerHTML="";
  let total=0,count=0;

  SUBJECTS.forEach(subject=>{
    const mark=result.marks?.[subject] ?? null;
    if(mark!==null){total+=Number(mark);count++;}
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${subject}</td><td>${mark===null?"-":mark}</td><td>${grade(mark)}</td>`;
    body.appendChild(tr);
  });

  const avg=count?total/count:0;
  document.getElementById("sharedTotal").textContent=total;
  document.getElementById("sharedAverage").textContent=avg.toFixed(1)+"%";
  document.getElementById("sharedOverall").textContent=count?grade(avg):"-";

  document.getElementById("commentBtn").onclick=postComment;
  await loadSharedComments(token);
}

async function postComment(){
  const name=document.getElementById("commentName").value.trim() || "Anonymous";
  const text=document.getElementById("commentText").value.trim();
  if(!text){showMessage("commentMessage","Write a comment first.",false);return;}
  const {error}=await supabaseClient.from("comments").insert({
    share_token:sharedToken, commenter_name:name, comment:text
  });
  if(error){showMessage("commentMessage",error.message,false);return;}
  document.getElementById("commentText").value="";
  showMessage("commentMessage","Comment posted.");
  await loadSharedComments(sharedToken);
}

async function loadSharedComments(token){
  const {data,error}=await supabaseClient.from("comments")
    .select("commenter_name,comment,created_at")
    .eq("share_token",token).order("created_at",{ascending:false});
  const box=document.getElementById("sharedComments");
  if(error){box.textContent=error.message;return;}
  box.innerHTML=(data||[]).map(c=>`
    <div class="comment">
      <strong>${escapeHtml(c.commenter_name)}</strong>
      <div>${escapeHtml(c.comment)}</div>
      <div class="comment-date">${new Date(c.created_at).toLocaleString()}</div>
    </div>`).join("") || '<p class="muted">No comments yet.</p>';
}

async function loadOwnerComments(){
  const {data,error}=await supabaseClient.rpc("get_my_comments");
  const box=document.getElementById("ownerComments");
  if(error){box.textContent="";return;}
  box.innerHTML=(data||[]).map(c=>`
    <div class="comment">
      <strong>${escapeHtml(c.commenter_name)}</strong>
      <div>${escapeHtml(c.comment)}</div>
      <div class="comment-date">${new Date(c.created_at).toLocaleString()}</div>
    </div>`).join("") || '<p class="muted">No comments yet.</p>';
}

async function logout(){
  await supabaseClient.auth.signOut();
  currentUser=null;
  showAuth();
}

function escapeHtml(value){
  const d=document.createElement("div");
  d.textContent=value ?? "";
  return d.innerHTML;
}

init();
