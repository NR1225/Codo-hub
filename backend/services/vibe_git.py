"""Vibecoding жобасының git репозиторийі (Source Control панелі үшін).

Жоба файлдары терминал workspace-інде тұрады (``terminal_workspace``), git те сонда
жұмыс істейді — терминалдағы ``git`` командаларымен бір репозиторий.

Қауіпсіздік: ``.git`` папкасын қолданушы терминалдан өзгерте алады, ал бұл модуль
git-ті backend процесінен іске қосады. Сондықтан:

* hook-тар өшірілген (``core.hooksPath`` бос папкаға), fsmonitor/pager/credential жоқ;
* ``.git/config`` тек рұқсат етілген кілттерден тұруы керек (filter/alias/include/
  sshCommand т.б. болса — операция орындалмайды);
* репозиторий іздеу жоқ: ``GIT_DIR``/``GIT_WORK_TREE`` нақты беріледі, ``.git`` нақты
  папка болуы керек (symlink немесе ``gitdir:`` файлы емес);
* жолдар ``--literal-pathspecs`` және ``--`` арқылы беріледі.
"""
import os
import re
import shutil
import subprocess
import tempfile
from typing import Dict, List, Optional, Tuple

from services.terminal_workspace import _clean_rel, _decode_text, _inside

GIT_TIMEOUT = 20
MAX_STATUS_FILES = 2000
MAX_LOG = 400
MAX_DIFF_BYTES = 256 * 1024

# Init кезінде .git/info/exclude-қа жазылады — тәуелділіктер мен кэш тарихқа кірмейді
DEFAULT_EXCLUDES = [
    "node_modules/", "__pycache__/", ".venv/", "venv/", "dist/", "build/", ".next/",
    ".nuxt/", ".cache/", ".pytest_cache/", ".mypy_cache/", "coverage/", "*.pyc", ".DS_Store",
]

# .git/config-та рұқсат етілген кілттер (қалғаны — код орындауға жол ашуы мүмкін)
_SAFE_CONFIG = [re.compile(p) for p in (
    r"core\.(repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase"
    r"|autocrlf|eol|safecrlf|precomposeunicode|quotepath)",
    r"user\.(name|email)",
    r"init\.defaultbranch",
    r"remote\.[^.]+(\..+)?\.(url|pushurl|fetch|tagopt|prune)",
    r"branch\.[^.]+(\..+)?\.(remote|merge|rebase|pushremote)",
    r"pull\.(rebase|ff)",
    r"push\.(default|autosetupremote)",
    r"fetch\.prune",
    r"extensions\.objectformat",
    r"gc\.auto",
    r"commit\.gpgsign",
)]

_SHA_RE = re.compile(r"^[0-9a-fA-F]{4,64}$")
_HOOKS_DIR = os.path.join(tempfile.gettempdir(), "codohub-empty-git-hooks")


class GitError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def available() -> bool:
    return shutil.which("git") is not None


def _git_dir(root: str) -> str:
    return os.path.join(root, ".git")


def is_repo(root: str) -> bool:
    path = _git_dir(root)
    return os.path.isdir(path) and not os.path.islink(path)


def _env(root: str) -> Dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({
        "GIT_DIR": _git_dir(root),
        "GIT_WORK_TREE": root,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_LITERAL_PATHSPECS": "1",
        "GIT_ASKPASS": "",
        "SSH_ASKPASS": "",
        "LC_ALL": "C.UTF-8",
    })
    return env


def _base_args(root: str) -> List[str]:
    os.makedirs(_HOOKS_DIR, exist_ok=True)
    return [
        "git",
        "-c", f"core.hooksPath={_HOOKS_DIR}",
        "-c", "core.fsmonitor=false",
        "-c", "core.pager=cat",
        "-c", "core.quotepath=false",
        "-c", "credential.helper=",
        "-c", "commit.gpgsign=false",
        "-c", "tag.gpgsign=false",
        "-c", "color.ui=false",
        "-c", "advice.detachedHead=false",
        "-c", f"safe.directory={root}",
        "--literal-pathspecs",
        "--no-pager",
    ]


def _check_config(root: str) -> None:
    """``.git/config``-та қауіпті кілт болса — git-ті іске қоспаймыз"""
    git_dir = _git_dir(root)
    if not is_repo(root):
        raise GitError("Репозиторий жоқ", 404)
    for extra in ("config.worktree", "commondir"):
        if os.path.exists(os.path.join(git_dir, extra)):
            raise GitError(f".git/{extra} қолдау көрсетілмейді")
    cfg = os.path.join(git_dir, "config")
    if not os.path.exists(cfg):
        return
    if os.path.islink(cfg):
        raise GitError(".git/config сілтеме болмауы керек")
    # --file арқылы тек оқу: include-тар ашылмайды, ештеңе орындалмайды
    proc = subprocess.run(
        ["git", "config", "--file", cfg, "--no-includes", "--list", "--null"],
        capture_output=True, timeout=GIT_TIMEOUT,
        env={k: v for k, v in _env(root).items() if k not in ("GIT_DIR", "GIT_WORK_TREE")},
    )
    if proc.returncode != 0:
        raise GitError(".git/config оқылмады")
    bad = []
    for entry in proc.stdout.decode("utf-8", "replace").split("\0"):
        if not entry:
            continue
        key = entry.split("\n", 1)[0].lower()
        if not any(p.fullmatch(key) for p in _SAFE_CONFIG):
            bad.append(key)
    if bad:
        raise GitError(
            "Қауіпсіздік үшін .git/config-тағы мына баптаулармен панель жұмыс істемейді: "
            + ", ".join(sorted(set(bad))[:8])
            + ". Оларды терминалда `git config --unset <кілт>` арқылы өшіріңіз."
        )


def run(root: str, *args: str, check: bool = True, input_text: Optional[str] = None) -> str:
    _check_config(root)
    try:
        proc = subprocess.run(
            [*_base_args(root), *args],
            cwd=root, env=_env(root), capture_output=True, timeout=GIT_TIMEOUT,
            input=input_text.encode("utf-8") if input_text is not None else None,
        )
    except subprocess.TimeoutExpired:
        raise GitError("git командасы тым ұзақ орындалды", 504)
    out = proc.stdout.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip() or out.strip()
        raise GitError(err[:600] or "git қатесі")
    return out


def _rel(path: str) -> str:
    rel = _clean_rel(path)
    if not rel or rel == ".git" or rel.startswith(".git/"):
        raise GitError(f"Жол дұрыс емес: {path}")
    return rel


# ─── Операциялар ──────────────────────────────────────────────────


def init(root: str, user_name: str) -> None:
    if is_repo(root):
        return
    if os.path.lexists(_git_dir(root)):
        raise GitError(".git файл немесе сілтеме ретінде бар")
    env = _env(root)
    env.pop("GIT_DIR")
    env.pop("GIT_WORK_TREE")
    proc = subprocess.run(
        ["git", "-c", "init.templateDir=", "init", "-q", "-b", "main", root],
        capture_output=True, timeout=GIT_TIMEOUT, env=env,
    )
    if proc.returncode != 0:
        raise GitError(proc.stderr.decode("utf-8", "replace")[:600] or "git init қатесі")
    info = os.path.join(_git_dir(root), "info")
    os.makedirs(info, exist_ok=True)
    with open(os.path.join(info, "exclude"), "a", encoding="utf-8") as f:
        f.write("\n# Codo Hub\n" + "\n".join(DEFAULT_EXCLUDES) + "\n")
    run(root, "config", "user.name", user_name)
    run(root, "config", "user.email", f"{_safe_email(user_name)}@users.codohub.local")


def _safe_email(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "", name) or "user"


def _parse_branch(line: str) -> dict:
    # "## main...origin/main [ahead 1, behind 2]" | "## No commits yet on main" | "## HEAD (no branch)"
    head = line[3:]
    info = {"branch": None, "upstream": None, "ahead": 0, "behind": 0, "detached": False}
    m = re.search(r"\[(.*)\]$", head)
    if m:
        for part in m.group(1).split(","):
            part = part.strip()
            if part.startswith("ahead "):
                info["ahead"] = int(part[6:] or 0)
            elif part.startswith("behind "):
                info["behind"] = int(part[7:] or 0)
        head = head[: m.start()].strip()
    if head.startswith("No commits yet on "):
        info["branch"] = head[len("No commits yet on "):]
    elif head.startswith("HEAD (no branch)"):
        info["detached"] = True
    else:
        branch, _, upstream = head.partition("...")
        info["branch"] = branch
        info["upstream"] = upstream or None
    return info


def status(root: str) -> dict:
    if not is_repo(root):
        return {"repo": False}
    out = run(root, "status", "--porcelain=v1", "-z", "-b", "--untracked-files=all")
    entries = out.split("\0")
    info: dict = {"repo": True}
    files = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if not entry:
            continue
        if entry.startswith("## "):
            info.update(_parse_branch(entry))
            continue
        x, y, path = entry[0], entry[1], entry[3:]
        orig = None
        if x in "RC":
            orig = entries[i] if i < len(entries) else None
            i += 1
        if len(files) < MAX_STATUS_FILES:
            files.append({"path": path, "orig": orig, "index": x, "worktree": y})
    info["files"] = files
    info["truncated"] = len(files) >= MAX_STATUS_FILES
    head = run(root, "rev-parse", "--verify", "-q", "HEAD", check=False).strip()
    info["head"] = head or None
    return info


def stage(root: str, paths: List[str]) -> None:
    if paths:
        run(root, "add", "-A", "--", *[_rel(p) for p in paths])
    else:
        run(root, "add", "-A")


def unstage(root: str, paths: List[str]) -> None:
    has_head = bool(run(root, "rev-parse", "--verify", "-q", "HEAD", check=False).strip())
    targets = [_rel(p) for p in paths]
    if has_head:
        run(root, "reset", "-q", "HEAD", "--", *targets)
    else:
        # Алғашқы коммитке дейін HEAD жоқ — индекстен алып тастаймыз
        run(root, "rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", *(targets or ["."]))


def discard(root: str, paths: List[str]) -> None:
    """Жұмыс папкасындағы өзгерістерді индекстегі (немесе HEAD) күйге қайтару"""
    st = status(root)
    by_path = {f["path"]: f for f in st.get("files", [])}
    restore = []
    for raw in paths:
        rel = _rel(raw)
        entry = by_path.get(rel)
        if not entry:
            continue
        if entry["index"] == "?":
            full = _inside(root, rel)
            if full and os.path.isfile(full):
                os.remove(full)
        elif entry["worktree"] != " ":
            restore.append(rel)
    if restore:
        run(root, "checkout", "-q", "--", *restore)


def commit(root: str, message: str, stage_all: bool, user_name: str) -> str:
    message = (message or "").strip()
    if not message:
        raise GitError("Коммит хабарламасы бос")
    identity: List[str] = []
    if not run(root, "config", "user.name", check=False).strip():
        identity += ["-c", f"user.name={user_name}"]
    if not run(root, "config", "user.email", check=False).strip():
        identity += ["-c", f"user.email={_safe_email(user_name)}@users.codohub.local"]
    if stage_all:
        run(root, "add", "-A")
    staged = run(root, "diff", "--cached", "--name-only", "-z")
    if not staged.strip("\0"):
        raise GitError("Коммитке дайын өзгеріс жоқ")
    run(root, *identity, "commit", "-q", "--no-verify", "-F", "-", input_text=message)
    return run(root, "rev-parse", "HEAD").strip()


def log(root: str, limit: int = 200) -> List[dict]:
    if not is_repo(root):
        return []
    limit = max(1, min(int(limit or 200), MAX_LOG))
    out = run(
        root, "log", "--all", "--topo-order", f"--max-count={limit}",
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e", check=False,
    )
    commits = []
    for record in out.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split("\x1f")
        if len(parts) < 7:
            continue
        sha, parents, author, email, ts, refs, subject = parts[:7]
        commits.append({
            "sha": sha,
            "parents": parents.split() if parents else [],
            "author": author,
            "email": email,
            "time": int(ts or 0),
            "refs": [r.strip() for r in refs.split(",") if r.strip()],
            "subject": subject,
        })
    return commits


def _cap(text: str) -> Tuple[str, bool]:
    data = text.encode("utf-8")
    if len(data) <= MAX_DIFF_BYTES:
        return text, False
    return data[:MAX_DIFF_BYTES].decode("utf-8", "ignore"), True


def file_diff(root: str, path: str, staged: bool) -> dict:
    rel = _rel(path)
    st = {f["path"]: f for f in status(root).get("files", [])}
    entry = st.get(rel)
    if entry and entry["index"] == "?" and not staged:
        full = _inside(root, rel)
        data = None
        if full and os.path.isfile(full) and os.path.getsize(full) <= MAX_DIFF_BYTES:
            with open(full, "rb") as f:
                data = f.read()
        text = _decode_text(data) if data is not None else None
        if text is None:
            return {"diff": "", "binary": True, "truncated": False}
        lines = text.splitlines()
        body = "".join(f"+{line}\n" for line in lines)
        diff = f"--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{len(lines)} @@\n{body}"
        diff, truncated = _cap(diff)
        return {"diff": diff, "binary": False, "truncated": truncated}
    args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"]
    if staged:
        args.append("--cached")
    out = run(root, *args, "--", rel)
    diff, truncated = _cap(out)
    return {"diff": diff, "binary": "Binary files" in out[:2000] and "@@" not in out, "truncated": truncated}


def show_commit(root: str, sha: str) -> dict:
    if not _SHA_RE.match(sha or ""):
        raise GitError("Коммит ID дұрыс емес")
    meta = run(root, "show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%B", sha)
    parts = meta.split("\x1f")
    if len(parts) < 7:
        raise GitError("Коммит табылмады", 404)
    full_sha, parents, author, email, ts, refs, body = parts[:7]
    names = run(
        root, "show", "--format=", "--name-status", "-z", "--no-renames",
        "--diff-merges=first-parent", full_sha,
    )
    files = []
    items = [x for x in names.split("\0")]
    i = 0
    while i + 1 < len(items):
        code, path = items[i], items[i + 1]
        i += 2
        if code:
            files.append({"status": code[0], "path": path})
    return {
        "sha": full_sha,
        "parents": parents.split() if parents else [],
        "author": author,
        "email": email,
        "time": int(ts or 0),
        "refs": [r.strip() for r in refs.split(",") if r.strip()],
        "message": body.strip(),
        "files": files,
    }


def commit_file_diff(root: str, sha: str, path: str) -> dict:
    if not _SHA_RE.match(sha or ""):
        raise GitError("Коммит ID дұрыс емес")
    rel = _rel(path)
    out = run(
        root, "show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color",
        "--diff-merges=first-parent", sha, "--", rel,
    )
    diff, truncated = _cap(out)
    return {"diff": diff, "binary": "Binary files" in out[:2000] and "@@" not in out, "truncated": truncated}
