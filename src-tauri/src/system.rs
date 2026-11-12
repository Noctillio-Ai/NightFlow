use tauri::command;

use crate::env::python_cmd;

/// Inline Python script that collects system metrics without importing autotimm.
/// This avoids the multi-second startup cost of loading PyTorch/timm via autotimm's __init__.
const SYSTEM_METRICS_SCRIPT: &str = r#"
import json,os,shutil,subprocess,sys,time
def sfloat(s):
 try:return float(s)
 except:return 0.0
r={}
r["cpu_cores"]=os.cpu_count() or 1
try:
 if sys.platform=="win32":
  import ctypes
  class FT(ctypes.Structure):
   _fields_=[("dwLow",ctypes.c_ulong),("dwHigh",ctypes.c_ulong)]
  def ft2int(ft):return ft.dwHigh<<32|ft.dwLow
  idle1,kern1,user1=FT(),FT(),FT()
  ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle1),ctypes.byref(kern1),ctypes.byref(user1))
  time.sleep(0.25)
  idle2,kern2,user2=FT(),FT(),FT()
  ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle2),ctypes.byref(kern2),ctypes.byref(user2))
  idle_d=ft2int(idle2)-ft2int(idle1);kern_d=ft2int(kern2)-ft2int(kern1);user_d=ft2int(user2)-ft2int(user1)
  total=kern_d+user_d;busy=total-idle_d
  r["cpu_percent"]=round(busy/total*100,1) if total>0 else 0
 elif sys.platform=="darwin":
  o=subprocess.check_output(["top","-l","1","-n","0","-s","0"]).decode()
  for l in o.split("\n"):
   if "CPU usage" in l:
    parts=l.split(",")
    u=s=0
    for p in parts:
     p=p.strip()
     if "user" in p:u=sfloat(p.split("%")[0].split()[-1])
     elif "sys" in p:s=sfloat(p.split("%")[0].split()[-1])
    r["cpu_percent"]=round(u+s,1);break
 else:
  with open("/proc/stat") as f:c1=f.readline().split()[1:]
  time.sleep(0.25)
  with open("/proc/stat") as f:c2=f.readline().split()[1:]
  t1=sum(int(x) for x in c1);t2=sum(int(x) for x in c2)
  i1=int(c1[3]);i2=int(c2[3])
  td=t2-t1;id_=i2-i1
  r["cpu_percent"]=round((td-id_)/td*100,1) if td>0 else 0
except:pass
try:
 if sys.platform=="darwin":
  mt=int(subprocess.check_output(["sysctl","-n","hw.memsize"]).strip())
  vm=subprocess.check_output(["vm_stat"]).decode()
  p={}
  for l in vm.split("\n"):
   if ":" in l:
    k,v=l.split(":",1);v=v.strip().rstrip(".")
    if v.isdigit():p[k.strip()]=int(v)
  ps=int(subprocess.check_output(["sysctl","-n","vm.pagesize"]).strip())
  anon=p.get("Anonymous pages",0);st=p.get("Pages stored in compressor",0);wi=p.get("Pages wired down",0)
  mu=(anon-st)*ps+wi*ps+st*ps
  r["mem_total"]=mt;r["mem_used"]=max(0,min(mu,mt))
 elif sys.platform=="win32":
  import ctypes
  class M(ctypes.Structure):
   _fields_=[("dwLength",ctypes.c_ulong),("dwMemoryLoad",ctypes.c_ulong),("ullTotalPhys",ctypes.c_ulonglong),("ullAvailPhys",ctypes.c_ulonglong),("ullTotalPageFile",ctypes.c_ulonglong),("ullAvailPageFile",ctypes.c_ulonglong),("ullTotalVirtual",ctypes.c_ulonglong),("ullAvailVirtual",ctypes.c_ulonglong),("ullAvailExtendedVirtual",ctypes.c_ulonglong)]
  m=M();m.dwLength=ctypes.sizeof(M);ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
  r["mem_total"]=m.ullTotalPhys;r["mem_used"]=m.ullTotalPhys-m.ullAvailPhys
 else:
  with open("/proc/meminfo") as f:lines=f.readlines()
  mt=mf=ma=0
  for l in lines:
   if l.startswith("MemTotal:"):mt=int(l.split()[1])*1024
   elif l.startswith("MemFree:"):mf=int(l.split()[1])*1024
   elif l.startswith("MemAvailable:"):ma=int(l.split()[1])*1024
  if mt>0:r["mem_total"]=mt;r["mem_used"]=mt-(ma if ma>0 else mf)
except:pass
try:
 dp="C:\\" if sys.platform=="win32" else "/"
 u=shutil.disk_usage(dp);r["disk_total"]=u.total;r["disk_used"]=u.used
except:pass
try:
 g=subprocess.check_output(["nvidia-smi","--query-gpu=index,name,utilization.gpu,memory.total,memory.used,temperature.gpu","--format=csv,noheader,nounits"],stderr=subprocess.STDOUT,text=True)
 gpus=[]
 for l in g.strip().split("\n"):
  if not l:continue
  p=[x.strip() for x in l.split(",")]
  if len(p)>=6:gpus.append({"index":int(p[0]),"name":p[1],"utilization":sfloat(p[2]),"mem_total":sfloat(p[3]),"mem_used":sfloat(p[4]),"temperature":sfloat(p[5])})
 r["gpus"]=gpus
except:r["gpus"]=[]
try:
 if hasattr(os,"getloadavg"):r["loadavg"]=os.getloadavg()
except:pass
print(json.dumps(r))
"#;

#[command]
pub async fn get_system_metrics(ssh_command: Option<String>, project_path: Option<String>) -> Result<String, String> {
    if let Some(cmd_str) = ssh_command {
        let parts: Vec<String> = cmd_str.split_whitespace().map(String::from).collect();
        if parts.is_empty() {
            return Err("Empty SSH command".to_string());
        }

        // For SSH: run inline script via python3 -c on remote
        let escaped = SYSTEM_METRICS_SCRIPT.replace('\'', "'\\''");
        let remote_cmd = format!("python3 -c '{escaped}'");

        let mut cmd = crate::tokio_command(&parts[0]);
        cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]);
        for arg in &parts[1..] {
            cmd.arg(arg);
        }
        cmd.arg(&remote_cmd);

        let output = cmd.output().await.map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    } else {
        let python = if let Some(ref pp) = project_path {
            let venv_python = crate::env::venv_python(&std::path::PathBuf::from(crate::expand_tilde(pp)).join(".venv"));
            if venv_python.exists() {
                venv_python.to_string_lossy().to_string()
            } else {
                python_cmd().to_string()
            }
        } else {
            python_cmd().to_string()
        };

        let output = crate::tokio_command(&python)
            .arg("-c")
            .arg(SYSTEM_METRICS_SCRIPT)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
}

#[derive(serde::Serialize)]
pub struct PushToHubResult {
    pub success: bool,
    pub url: String,
    pub message: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PushToHubParams {
    pub project_path: String,
    pub run_id: String,
    #[serde(default)]
    pub run_name: String,
    pub repo_id: String,
    pub hf_token: String,
    pub task_class: Option<String>,
    pub task_type: Option<String>,
    pub backbone: Option<String>,
    pub num_classes: Option<u32>,
    pub image_size: Option<u32>,
    pub best_acc: Option<f64>,
    pub test_acc: Option<f64>,
    pub ssh_command: Option<String>,
    pub private: Option<bool>,
    pub model_name: Option<String>,
    pub description: Option<String>,
    pub license: Option<String>,
    pub tags: Option<String>,
}

#[command]
pub async fn push_to_hub(params: PushToHubParams) -> Result<PushToHubResult, String> {
    let pp = params.project_path.trim_end_matches('/').trim_end_matches('\\');
    let pp_path = std::path::PathBuf::from(pp);
    let run_logs_dir_path = pp_path.join("logs").join(&params.run_id);
    let ckpt_dir = run_logs_dir_path.join("checkpoints");
    let hparams_path = run_logs_dir_path.join("hparams.yaml");

    let tt = params.task_type.unwrap_or_else(|| "Classification".to_string());
    let bb = params.backbone.unwrap_or_else(|| "unknown".to_string());
    let nc = params.num_classes.unwrap_or(10);
    let isize = params.image_size.unwrap_or(224);
    let is_private = params.private.unwrap_or(false);

    let acc_str = params.best_acc.map_or("N/A".to_string(), |v| format!("{:.4}", v));
    let test_acc_str = params.test_acc.map_or("N/A".to_string(), |v| format!("{:.4}", v));
    let mn = params.model_name.unwrap_or_else(|| format!("{bb} — {tt}"));
    let desc = params.description.unwrap_or_default();
    let lic = params.license.unwrap_or_else(|| "apache-2.0".to_string());
    let user_tags = params.tags.unwrap_or_default();

    // Build a JSON config to pass to the Python script via env var
    let config = serde_json::json!({
        "repo_id": params.repo_id,
        "token": params.hf_token,
        "ckpt_dir": ckpt_dir.to_string_lossy(),
        "hparams_path": hparams_path.to_string_lossy(),
        "task_type": tt,
        "backbone": bb,
        "num_classes": nc,
        "image_size": isize,
        "acc_str": acc_str,
        "test_acc_str": test_acc_str,
        "is_private": is_private,
        "model_name": mn,
        "description": desc,
        "license": lic,
        "tags": user_tags,
    });
    let config_json = config.to_string();

    let push_module = "autotimm.flow.push_to_hub";

    // For SSH: pass config via HF_PUSH_CFG env var in the remote command
    // For local: pass it via the HF_PUSH_CFG environment variable
    let output = if let Some(ssh_cmd) = params.ssh_command {
        let parts: Vec<String> = ssh_cmd.split_whitespace().map(String::from).collect();
        if parts.len() < 2 {
            return Err("Invalid SSH command".to_string());
        }
        let escaped_json = config_json.replace('\\', "\\\\").replace('"', "\\\"");
        // Resolve python on remote: prefer project venv, fall back to python3
        let venv_python = crate::env::venv_python(&pp_path.join(".venv"));
        let venv_str = venv_python.to_string_lossy().to_string();
        let remote_cmd = format!(
            "HF_PUSH_CFG=\"{escaped_json}\" bash -c 'if [ -x \"{venv_str}\" ]; then \"{venv_str}\" -m {push_module}; else python3 -m {push_module}; fi'",
        );
        crate::tokio_command(&parts[0])
            .args(&parts[1..])
            .arg(remote_cmd)
            .output()
            .await
            .map_err(|e| format!("SSH failed: {e}"))?
    } else {
        let venv_python = crate::env::venv_python(&pp_path.join(".venv"));
        let python = if venv_python.exists() {
            venv_python.to_string_lossy().to_string()
        } else {
            python_cmd().to_string()
        };
        crate::tokio_command(&python)
            .arg("-m")
            .arg(push_module)
            .env("HF_PUSH_CFG", &config_json)
            .current_dir(&run_logs_dir_path)
            .output()
            .await
            .map_err(|e| format!("Push to Hub failed: {e}"))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Push to Hub failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse output: {e}\nOutput: {stdout}"))?;

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    let url = parsed.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();

    Ok(PushToHubResult {
        success: true,
        url: url.clone(),
        message: format!("Model pushed to {url}"),
    })
}
