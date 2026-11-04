"""Codo репозиторийі — жобаның серверде сақталатын «ресми» git нұсқасы.

Логика (GitHub сияқты, бірақ Codo ішінде):

* **Codo-ға жіберу (push)** — жұмыс папкасындағы бұтақ серверлік bare репозиторийге
  жазылады. Codo-дағы нұсқа = жобаның толық жаңартылған, басқаларға көрінетін коды.
* **Жүктеу (fork)** — басқа қолданушы жобаны көшіргенде код Codo-дағы соңғы
  нұсқадан, барлық коммит тарихымен бірге алынады. Fork-тың өз Codo репозиторийі болады,
  ал түпнұсқа ``upstream`` ретінде байланысып тұрады (жаңартуларды тартуға болады).
* **Pull request** — fork иесі (немесе жоба иесі басқа бұтақтан) PR ашады. PR-дың
  коммиттері түпнұсқаның Codo репозиторийіне ``refs/pull/<n>/head`` болып көшіріледі,
  сондықтан fork өшсе де PR көрінеді. Merge тікелей bare репозиторийде жасалады
  (``git merge-tree --write-tree`` + ``commit-tree``), жұмыс папкасы қажет емес.

Қауіпсіздік: bare репозиторийлердің жолын тек сервер есептейді (жоба ID-сінен),
қолданушының ``.git/config``-тағы remote URL-дері ешқашан қолданылмайды.
"""
import os
import re
import shutil
import subprocess
from typing import Dict, List, Optional

from config import CODO_REPOS_DIR
from services import vibe_git
from services.vibe_git import GitError

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_EXPORT_FILES = 3000
MAX_EXPORT_BYTES = 30 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_PR_COMMITS = 250
MAX_PR_FILES = 1000


def _bare_path(project_id: str) -> str:
    if not _ID_RE.match(project_id or ""):
        raise GitError("Жоба ID дұрыс емес")
    return os.path.join(CODO_REPOS_DIR, f"{project_id}.git")


def exists(project_id: str) -> bool:
    try:
        return os.path.isdir(_bare_path(project_id))
    except GitError:
        return False


def _bare_env(bare: str) -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({
        "GIT_DIR": bare,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C.UTF-8",
    })
    return env


def _bare(bare: str, *args: str, check: bool = True, input_text: Optional[str] = None) -> str:
    """Серверлік bare репозиторийде git (оның config-ін тек сервер жазады)"""
    base = [a for a in vibe_git._base_args(bare) if a != "--literal-pathspecs"]
    try:
        proc = subprocess.run(
            [*base, "-c", "transfer.fsckObjects=true", *args],
            env=_bare_env(bare), capture_output=True, timeout=vibe_git.GIT_TIMEOUT * 3,
            input=input_text.encode("utf-8") if input_text is not None else None,
        )
    except subprocess.TimeoutExpired:
        raise GitError("git командасы тым ұзақ орындалды", 504)
    out = proc.stdout.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        raise GitError((proc.stderr.decode("utf-8", "replace").strip() or out.strip())[:600] or "git қатесі")
    return out


def _ws(root: str, *args: str, check: bool = True) -> str:
    """Жұмыс папкасындағы git — local transport + fsck (bare-ге бөтен объект кірмесін)"""
    return vibe_git.run(root, "-c", "transfer.fsckObjects=true", "-c", "protocol.file.allow=always",
                        *args, check=check)


def ensure(project_id: str) -> str:
    bare = _bare_path(project_id)
    if os.path.isdir(bare):
        return bare
    os.makedirs(CODO_REPOS_DIR, exist_ok=True)
    env = _bare_env(bare)
    env.pop("GIT_DIR")
    proc = subprocess.run(
        ["git", "-c", "init.templateDir=", "init", "--bare", "-q", "-b", "main", bare],
        capture_output=True, timeout=vibe_git.GIT_TIMEOUT, env=env,
    )
    if proc.returncode != 0:
        raise GitError(proc.stderr.decode("utf-8", "replace")[:600] or "Codo репозиторийі жасалмады")
    _bare(bare, "config", "receive.denyNonFastForwards", "false")
    _bare(bare, "config", "uploadpack.allowReachableSHA1InWant", "true")
    return bare


def remove(project_id: str) -> None:
    try:
        bare = _bare_path(project_id)
    except GitError:
        return
    shutil.rmtree(bare, ignore_errors=True)


def _sha(bare: str, ref: str) -> Optional[str]:
    return _bare(bare, "rev-parse", "--verify", "-q", ref + "^{commit}", check=False).strip() or None


def default_branch(project_id: str) -> Optional[str]:
    if not exists(project_id):
        return None
    bare = _bare_path(project_id)
    head = _bare(bare, "symbolic-ref", "-q", "--short", "HEAD", check=False).strip()
    if head and _sha(bare, f"refs/heads/{head}"):
        return head
    first = _bare(bare, "for-each-ref", "--count=1", "--format=%(refname:short)", "refs/heads", check=False).strip()
    return first or None


def branches(project_id: str) -> List[dict]:
    if not exists(project_id):
        return []
    bare = _bare_path(project_id)
    out = _bare(bare, "for-each-ref", "--sort=-committerdate",
                "--format=%(refname:short)%1f%(objectname)%1f%(committerdate:unix)%1f%(subject)",
                "refs/heads", check=False)
    items = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) >= 4:
            items.append({"name": parts[0], "sha": parts[1], "time": int(parts[2] or 0), "subject": parts[3]})
    return items


# ─── Жұмыс папкасы ↔ Codo ─────────────────────────────────────────


def _current_branch(root: str) -> str:
    st = vibe_git.status(root)
    if not st.get("repo"):
        raise GitError("Алдымен репозиторий жасаңыз")
    if st.get("detached") or not st.get("branch"):
        raise GitError("Detached HEAD күйінде жіберу мүмкін емес — бұтаққа ауысыңыз")
    if not st.get("head"):
        raise GitError("Алдымен кемінде бір коммит жасаңыз")
    return st["branch"]


def fetch(root: str, project_id: str, prefix: str = "codo") -> None:
    """Codo-дағы бұтақтарды жұмыс папкасына ``refs/remotes/<prefix>/*`` етіп алу"""
    if not exists(project_id) or not vibe_git.is_repo(root):
        return
    bare = _bare_path(project_id)
    if not _bare(bare, "for-each-ref", "--count=1", "refs/heads", check=False).strip():
        return
    _ws(root, "fetch", "-q", "--prune", "--no-tags", bare,
        f"+refs/heads/*:refs/remotes/{prefix}/*")


def push(root: str, project_id: str, branch: Optional[str] = None, force: bool = False) -> dict:
    branch = vibe_git._branch_name(branch) if branch else _current_branch(root)
    if not vibe_git.run(root, "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False).strip():
        raise GitError(f"Бұтақ табылмады: {branch}", 404)
    bare = ensure(project_id)
    spec = f"{'+' if force else ''}refs/heads/{branch}:refs/heads/{branch}"
    try:
        _ws(root, "push", "-q", "--no-verify", bare, spec)
    except GitError as e:
        text = str(e)
        if "non-fast-forward" in text or "rejected" in text or "fetch first" in text:
            raise GitError("Codo-да сізде жоқ жаңа коммиттер бар. Алдымен «Codo-дан тарту» жасаңыз "
                           "(немесе мәжбүрлі жіберу).", 409)
        raise
    # Алғашқы жіберу — Codo-ның негізгі бұтағы осы болады
    head = _bare(bare, "symbolic-ref", "-q", "--short", "HEAD", check=False).strip()
    if not head or not _sha(bare, f"refs/heads/{head}"):
        _bare(bare, "symbolic-ref", "HEAD", f"refs/heads/{branch}")
    fetch(root, project_id)
    return {"branch": branch, "sha": _sha(bare, f"refs/heads/{branch}")}


def pull(root: str, project_id: str, user_name: str, prefix: str = "codo",
         source_project: Optional[str] = None, branch: Optional[str] = None) -> None:
    """Codo-дан (немесе upstream-нан) ағымдағы бұтаққа жаңартуларды біріктіру"""
    current = _current_branch(root) if vibe_git.status(root).get("head") else None
    src = source_project or project_id
    if not exists(src):
        raise GitError("Codo-да әлі ештеңе жоқ")
    fetch(root, src, prefix)
    target = branch or current or default_branch(src)
    remote_ref = f"refs/remotes/{prefix}/{target}"
    if not vibe_git.run(root, "rev-parse", "--verify", "-q", remote_ref, check=False).strip():
        target = default_branch(src)
        remote_ref = f"refs/remotes/{prefix}/{target}"
        if not target or not vibe_git.run(root, "rev-parse", "--verify", "-q", remote_ref, check=False).strip():
            raise GitError(f"Codo-да «{branch or current}» бұтағы жоқ")
    if not current:
        # Жергілікті коммит жоқ — Codo нұсқасын тікелей аламыз
        vibe_git.run(root, "checkout", "-q", "-B", target, remote_ref, "--")
        return
    vibe_git.run(root, *vibe_git._identity(root, user_name), "merge", "--no-edit", "--no-verify",
                 "-m", f"Merge {prefix}/{target} into {current}", remote_ref)


def sync_info(root: str, project_id: str, parent_id: Optional[str]) -> dict:
    """Ағымдағы бұтақ Codo-мен (және upstream-мен) салыстырғанда қанша алда/артта"""
    info: dict = {"exists": exists(project_id), "branch": None, "ahead": 0, "behind": 0,
                  "published": False, "upstream": None}
    st = vibe_git.status(root) if vibe_git.is_repo(root) else {"repo": False}
    branch = st.get("branch") if st.get("repo") and not st.get("detached") else None
    info["branch"] = branch

    def counts(ref: str):
        out = vibe_git.run(root, "rev-list", "--left-right", "--count", f"HEAD...{ref}", check=False).split()
        return (int(out[0]), int(out[1])) if len(out) == 2 else (0, 0)

    if branch and st.get("head"):
        ref = f"refs/remotes/codo/{branch}"
        if vibe_git.run(root, "rev-parse", "--verify", "-q", ref, check=False).strip():
            info["published"] = True
            info["ahead"], info["behind"] = counts(ref)
        else:
            info["ahead"] = int(vibe_git.run(root, "rev-list", "--count", "HEAD", check=False).strip() or 0)
    if parent_id and exists(parent_id):
        up_branch = default_branch(parent_id)
        up = {"projectId": parent_id, "branch": up_branch, "ahead": 0, "behind": 0}
        ref = f"refs/remotes/upstream/{up_branch}"
        if up_branch and st.get("head") and vibe_git.run(root, "rev-parse", "--verify", "-q", ref, check=False).strip():
            up["ahead"], up["behind"] = counts(ref)
        info["upstream"] = up
    return info


# ─── Fork: Codo нұсқасын тарихымен көшіру ─────────────────────────

_LANG = {
    "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript", "mjs": "javascript",
    "py": "python", "rb": "ruby", "rs": "rust", "go": "go", "java": "java", "cpp": "cpp", "c": "c",
    "cs": "csharp", "php": "php", "swift": "swift", "kt": "kotlin", "html": "html", "htm": "html",
    "css": "css", "scss": "scss", "less": "less", "json": "json", "md": "markdown", "yaml": "yaml",
    "yml": "yaml", "xml": "xml", "sql": "sql", "sh": "shell", "bash": "shell",
}


def export_files(project_id: str, ref: Optional[str] = None) -> Optional[dict]:
    """Codo бұтағындағы файлдар (fork үшін): {"files": [...], "folders": [...]} немесе None"""
    import uuid

    if not exists(project_id):
        return None
    bare = _bare_path(project_id)
    ref = ref or default_branch(project_id)
    if not ref or not _sha(bare, f"refs/heads/{ref}"):
        return None
    listing = _bare(bare, "ls-tree", "-r", "-z", "--long", f"refs/heads/{ref}")
    files, folders, total = [], set(), 0
    for entry in listing.split("\0"):
        if not entry or "\t" not in entry:
            continue
        meta, path = entry.split("\t", 1)
        parts = meta.split()
        if len(parts) < 4 or parts[1] != "blob" or parts[0] == "120000":
            continue
        size = int(parts[3]) if parts[3].isdigit() else 0
        if size > MAX_FILE_BYTES or len(files) >= MAX_EXPORT_FILES or total + size > MAX_EXPORT_BYTES:
            continue
        proc = subprocess.run(
            [*[a for a in vibe_git._base_args(bare) if a != "--literal-pathspecs"], "cat-file", "blob", parts[2]],
            env=_bare_env(bare), capture_output=True, timeout=vibe_git.GIT_TIMEOUT,
        )
        if proc.returncode != 0:
            continue
        text = vibe_git._decode_text(proc.stdout)
        if text is None:
            continue
        total += size
        name = path.rsplit("/", 1)[-1]
        files.append({
            "id": str(uuid.uuid4()), "name": name, "path": path, "content": text,
            "language": _LANG.get(name.rsplit(".", 1)[-1].lower() if "." in name else "", "plaintext"),
        })
        segs = path.split("/")[:-1]
        for i in range(len(segs)):
            folders.add("/".join(segs[: i + 1]))
    return {"files": files, "folders": sorted(folders), "branch": ref}


def fork_repo(source_id: str, fork_id: str) -> bool:
    """Fork-тың Codo репозиторийін түпнұсқаның барлық тарихымен жасау"""
    if not exists(source_id):
        return False
    src = _bare_path(source_id)
    dst = _bare_path(fork_id)
    if os.path.isdir(dst):
        return True
    os.makedirs(CODO_REPOS_DIR, exist_ok=True)
    env = _bare_env(dst)
    env.pop("GIT_DIR")
    proc = subprocess.run(
        ["git", "-c", "init.templateDir=", "-c", "protocol.file.allow=always", "clone", "--bare",
         "--no-hardlinks", "-q", src, dst],
        capture_output=True, timeout=vibe_git.GIT_TIMEOUT * 3, env=env,
    )
    if proc.returncode != 0:
        shutil.rmtree(dst, ignore_errors=True)
        raise GitError(proc.stderr.decode("utf-8", "replace")[:600] or "Fork репозиторийі жасалмады")
    # clone «origin» remote-ын жазады — керек емес (жолдар тек сервер есептейді)
    _bare(dst, "remote", "remove", "origin", check=False)
    return True


def init_workspace_from_codo(root: str, project_id: str, user_name: str,
                             parent_id: Optional[str] = None) -> bool:
    """Жаңа жұмыс папкасын Codo репозиторийімен байланыстыру (fork-тан кейін):
    файлдар Codo нұсқасымен бірдей, сондықтан күй таза болады"""
    branch = default_branch(project_id)
    if not branch:
        return False
    if not vibe_git.is_repo(root):
        vibe_git.init(root, user_name)
    fetch(root, project_id)
    if parent_id:
        fetch(root, parent_id, "upstream")
    vibe_git.run(root, "update-ref", f"refs/heads/{branch}", f"refs/remotes/codo/{branch}")
    vibe_git.run(root, "symbolic-ref", "HEAD", f"refs/heads/{branch}")
    vibe_git.run(root, "reset", "-q")
    return True


# ─── Pull request ─────────────────────────────────────────────────


def pr_ref(number: int) -> str:
    return f"refs/pull/{int(number)}/head"


def pr_snapshot(target_id: str, source_id: str, source_branch: str, number: int) -> str:
    """PR коммиттерін түпнұсқаның Codo репозиторийіне көшіру; head SHA қайтарады"""
    source_branch = vibe_git._branch_name(source_branch)
    if not exists(source_id):
        raise GitError("Алдымен бұтақты Codo-ға жіберіңіз")
    src = _bare_path(source_id)
    if not _sha(src, f"refs/heads/{source_branch}"):
        raise GitError(f"Codo-да «{source_branch}» бұтағы жоқ — алдымен жіберіңіз")
    dst = ensure(target_id)
    if source_id == target_id:
        sha = _sha(dst, f"refs/heads/{source_branch}")
        _bare(dst, "update-ref", pr_ref(number), sha)
        return sha
    _bare(dst, "-c", "protocol.file.allow=always", "fetch", "-q", "--no-tags", src,
          f"+refs/heads/{source_branch}:{pr_ref(number)}")
    return _sha(dst, pr_ref(number))


def pr_compare(target_id: str, target_branch: str, number: int) -> dict:
    """PR коммиттері, өзгерген файлдар және конфликт бар-жоғы"""
    bare = _bare_path(target_id)
    head = _sha(bare, pr_ref(number))
    base_tip = _sha(bare, f"refs/heads/{target_branch}")
    if not head:
        return {"commits": [], "files": [], "mergeable": False, "conflicts": [], "upToDate": False}
    rng = f"{base_tip}..{head}" if base_tip else head
    out = _bare(bare, "log", f"--max-count={MAX_PR_COMMITS}",
                "--format=%H%x1f%an%x1f%at%x1f%s%x1e", rng, check=False)
    commits = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        parts = rec.split("\x1f")
        if len(parts) >= 4:
            commits.append({"sha": parts[0], "author": parts[1], "time": int(parts[2] or 0), "subject": parts[3]})
    files = []
    base = _bare(bare, "merge-base", base_tip, head, check=False).strip() if base_tip else ""
    if base or not base_tip:
        diff_args = ["diff", "--name-status", "-z", "--no-renames"]
        diff_args += [base, head] if base else ["4b825dc642cb6eb9a060e54bf8d69288fbee4904", head]
        items = _bare(bare, *diff_args, check=False).split("\0")
        i = 0
        while i + 1 < len(items) and len(files) < MAX_PR_FILES:
            code, path = items[i], items[i + 1]
            i += 2
            if code:
                files.append({"status": code[0], "path": path})
    mergeable, conflicts = True, []
    if base_tip and not commits:
        mergeable = False
    elif base_tip:
        proc = subprocess.run(
            [*[a for a in vibe_git._base_args(bare) if a != "--literal-pathspecs"],
             "merge-tree", "--write-tree", "--name-only", "-z", "--no-messages", base_tip, head],
            env=_bare_env(bare), capture_output=True, timeout=vibe_git.GIT_TIMEOUT,
        )
        if proc.returncode == 1:
            mergeable = False
            parts = proc.stdout.decode("utf-8", "replace").split("\0")
            conflicts = sorted({p for p in parts[1:] if p})[:100]
        elif proc.returncode != 0:
            mergeable = False
    return {"commits": commits, "files": files, "mergeable": mergeable, "conflicts": conflicts,
            "upToDate": bool(base_tip) and not commits, "head": head, "base": base_tip}


def pr_file_diff(target_id: str, target_branch: str, number: int, path: str) -> dict:
    bare = _bare_path(target_id)
    rel = vibe_git._rel(path)
    head = _sha(bare, pr_ref(number))
    base_tip = _sha(bare, f"refs/heads/{target_branch}")
    if not head:
        raise GitError("PR коммиттері табылмады", 404)
    base = (_bare(bare, "merge-base", base_tip, head, check=False).strip() if base_tip else "") \
        or "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    out = _bare(bare, "diff", "--no-ext-diff", "--no-textconv", "--no-color", base, head, "--", rel)
    diff, truncated = vibe_git._cap(out)
    return {"diff": diff, "binary": "Binary files" in out[:2000] and "@@" not in out, "truncated": truncated}


def _ancestor(bare: str, a: str, b: str) -> bool:
    base = [x for x in vibe_git._base_args(bare) if x != "--literal-pathspecs"]
    proc = subprocess.run([*base, "merge-base", "--is-ancestor", a, b],
                          env=_bare_env(bare), capture_output=True, timeout=vibe_git.GIT_TIMEOUT)
    return proc.returncode == 0


def pr_merge(target_id: str, target_branch: str, number: int, message: str,
             user_name: str, email: str, squash: bool = False) -> str:
    """PR-ды Codo-дағы мақсатты бұтаққа біріктіру (жұмыс папкасыз)"""
    bare = _bare_path(target_id)
    head = _sha(bare, pr_ref(number))
    if not head:
        raise GitError("PR коммиттері табылмады", 404)
    base_tip = _sha(bare, f"refs/heads/{target_branch}")
    ident = ["-c", f"user.name={user_name}", "-c", f"user.email={email}"]
    if not base_tip:
        _bare(bare, "update-ref", f"refs/heads/{target_branch}", head)
        return head
    if _ancestor(bare, head, base_tip):
        raise GitError("PR-дағы өзгерістер бұтақта бар")
    proc = subprocess.run(
        [*[a for a in vibe_git._base_args(bare) if a != "--literal-pathspecs"],
         "merge-tree", "--write-tree", "-z", "--no-messages", base_tip, head],
        env=_bare_env(bare), capture_output=True, timeout=vibe_git.GIT_TIMEOUT,
    )
    if proc.returncode == 1:
        raise GitError("Конфликт бар — PR-ды автоматты біріктіру мүмкін емес. Авторы өз бұтағын "
                       "жаңартып (target-ты merge жасап), қайта жіберуі керек.", 409)
    if proc.returncode != 0:
        raise GitError(proc.stderr.decode("utf-8", "replace")[:600] or "merge-tree қатесі")
    tree = proc.stdout.decode("utf-8", "replace").split("\0")[0].strip()
    parents = ["-p", base_tip] if squash else ["-p", base_tip, "-p", head]
    commit = _bare(bare, *ident, "commit-tree", tree, *parents, "-F", "-", input_text=message).strip()
    _bare(bare, "update-ref", f"refs/heads/{target_branch}", commit, base_tip)
    return commit
