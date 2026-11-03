"""Аккаунтты толық өшіру — қолданушының өзі (DELETE /user) де, әкімші де (routes/admin.py) осыны қолданады."""
from sqlalchemy.orm import Session

from database import (
    codes, friends, messages, friend_requests,
    save_codes, save_friends, save_messages, save_friend_requests,
)
from db import (
    User, Story, StoryOpinion, Note, NoteVault, VibecodingProject, ChatGroup, ChatGroupMember,
    ChatPref, TrustedDevice,
)
from services.cli_token_service import CliTokenService


def rename_author(old: str, new: str) -> int:
    """Username ауысқанда жобалардағы автор/мүше/пікір авторы атауын жаңарту"""
    changed = 0
    for code in codes:
        touched = False
        if code.get('author') == old:
            code['author'] = new
            touched = True
        if old in (code.get('members') or []):
            code['members'] = [new if m == old else m for m in code['members']]
            touched = True
        for comment in code.get('comments') or []:
            if comment.get('author') == old:
                comment['author'] = new
                touched = True
            for reply in comment.get('replies') or []:
                if reply.get('author') == old:
                    reply['author'] = new
                    touched = True
        changed += touched
    if changed:
        save_codes()
    return changed


def delete_account(db: Session, user: User) -> None:
    """Қолданушыны және оның барлық деректерін өшіру"""
    from services.story_service import _remove_file

    user_id = user.id
    username = user.username

    # Жобалары
    codes[:] = [code for code in codes if code.get('author') != username]

    # Достар тізімі
    friends.pop(user_id, None)
    for friend_user_id in friends:
        if friends[friend_user_id]:
            friends[friend_user_id] = [fid for fid in friends[friend_user_id] if fid != user_id]
    save_friends()

    # Жеке хабарламалары мен достық өтінімдері
    messages[:] = [m for m in messages if m.get('fromUserId') != user_id and m.get('toUserId') != user_id]
    save_messages()
    friend_requests[:] = [r for r in friend_requests if r.get('fromUserId') != user_id and r.get('toUserId') != user_id]
    save_friend_requests()

    # Қалған жобалардағы лайктары мен пікірлері
    for code in codes:
        if 'likes' in code:
            code['likes'] = [uid for uid in code['likes'] if uid != user_id]
        if 'comments' in code:
            code['comments'] = [c for c in code['comments'] if c.get('author') != username]
            for comment in code['comments']:
                if 'likes' in comment:
                    comment['likes'] = [uid for uid in comment['likes'] if uid != user_id]
                if 'replies' in comment:
                    comment['replies'] = [r for r in comment['replies'] if r.get('author') != username]
    save_codes()

    # SQL деректері: сторис, пікірлер, жазбалар, Vibecoding, топ мүшелігі, құрылғылар
    for story in db.query(Story).filter(Story.author_id == user_id).all():
        _remove_file(story.media_url)
        db.query(StoryOpinion).filter(StoryOpinion.story_id == story.id).delete()
        db.delete(story)
    db.query(StoryOpinion).filter((StoryOpinion.author_id == user_id) | (StoryOpinion.target_id == user_id)).delete(
        synchronize_session=False)
    db.query(Note).filter(Note.owner_id == user_id).delete()
    db.query(NoteVault).filter(NoteVault.owner_id == user_id).delete()
    db.query(VibecodingProject).filter(VibecodingProject.owner_id == user_id).delete()
    db.query(ChatPref).filter(ChatPref.user_id == user_id).delete()
    db.query(TrustedDevice).filter(TrustedDevice.user_id == user_id).delete()

    # Иесі болған топтар: басқа мүше қалса — иелік соған өтеді, қалмаса — топ өшеді
    from services.group_service import GroupService
    for group in db.query(ChatGroup).filter(ChatGroup.owner_id == user_id).all():
        heir = db.query(ChatGroupMember).filter(
            ChatGroupMember.group_id == group.id, ChatGroupMember.user_id != user_id
        ).order_by(ChatGroupMember.joined_at).first()
        if heir:
            group.owner_id = heir.user_id
            heir.role = "owner"
        else:
            db.commit()
            GroupService._delete_group_rows(db, group.id)
    db.query(ChatGroupMember).filter(ChatGroupMember.user_id == user_id).delete()

    CliTokenService.revoke_all(db, user_id)
    db.delete(user)
    db.commit()
