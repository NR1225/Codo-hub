"""Code-related Pydantic models"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any


class CodeCreate(BaseModel):
    title: str = Field(max_length=200)
    content: str = Field(max_length=100000)
    language: str = Field(max_length=50)
    author: str = Field(max_length=50)
    description: Optional[str] = Field(default=None, max_length=2000)
    tags: Optional[List[str]] = []
    folderId: Optional[str] = None
    folderPath: Optional[str] = None
    isFolder: Optional[bool] = False
    folderStructure: Optional[Any] = None


class CodeUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = Field(default=None, max_length=100000)
    language: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=2000)
    tags: Optional[List[str]] = None


class CommentCreate(BaseModel):
    author: str = Field(max_length=50)
    content: str = Field(max_length=2000)
    parentId: Optional[str] = Field(default=None, max_length=100)


class CommentUpdate(BaseModel):
    content: str = Field(max_length=2000)


class ViewRequest(BaseModel):
    userId: Optional[str] = Field(default=None, max_length=50)


class DeleteMultipleRequest(BaseModel):
    ids: List[str] = Field(max_length=100)

