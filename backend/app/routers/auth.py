"""Authentication: login, current user, change password."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.Token)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.username == payload.username)
        .first()
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(user.username)
    return schemas.Token(
        access_token=token,
        must_change_password=user.must_change_password,
    )


@router.get("/me", response_model=schemas.UserOut)
def me(current: models.User = Depends(get_current_user)):
    return current


@router.post("/change-password", response_model=schemas.UserOut)
def change_password(
    payload: schemas.ChangePasswordRequest,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current one",
        )
    current.password_hash = hash_password(payload.new_password)
    current.must_change_password = False
    db.commit()
    db.refresh(current)
    return current
