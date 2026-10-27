# Codo Hub Backend

FastAPI backend for Codo Hub application.

## Features

- Code file management (CRUD operations)
- User authentication (register, login, change password)
- User profile management
- Friends system
- Messages system
- Friend requests system
- Comments and likes on codes

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the server:
```bash
uvicorn main:app --reload --port 3000
```

Or using Python directly:
```bash
python main.py
```

The server will run on port 3000 by default (or the PORT environment variable if set).

## API Endpoints

### Health Check
- `GET /api/health` - Health check endpoint

### Codes
- `GET /api/codes` - Get all codes (optionally filtered by folderId)
- `GET /api/codes/{id}` - Get a single code by ID
- `POST /api/codes` - Create a new code
- `PUT /api/codes/{id}` - Update a code
- `DELETE /api/codes/{id}` - Delete a code
- `POST /api/codes/delete-multiple` - Delete multiple codes
- `POST /api/codes/{id}/like` - Like a code
- `POST /api/codes/{id}/unlike` - Unlike a code
- `POST /api/codes/{id}/view` - Increment view count
- `POST /api/codes/{id}/comments` - Add a comment
- `PUT /api/codes/{id}/comments/{commentId}` - Update a comment
- `DELETE /api/codes/{id}/comments/{commentId}` - Delete a comment
- `POST /api/codes/{id}/comments/{commentId}/like` - Like a comment

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login
- `POST /api/auth/change-password` - Change password

### Users
- `GET /api/user` - Get current user
- `PUT /api/user` - Update user profile
- `DELETE /api/user` - Delete user account
- `GET /api/users/{id}` - Get user by ID
- `GET /api/users/search` - Search users

### Friends
- `GET /api/friends/{userId}` - Get user's friends
- `POST /api/friends/{userId}/add` - Add a friend
- `DELETE /api/friends/{userId}/remove/{friendId}` - Remove a friend

### Messages
- `GET /api/messages/{userId}` - Get all messages for a user
- `GET /api/messages/{userId}/{friendId}` - Get conversation between two users
- `POST /api/messages` - Send a message
- `PUT /api/messages/{messageId}/read` - Mark message as read

### Friend Requests
- `GET /api/friend-requests/{userId}` - Get friend requests for a user
- `GET /api/friend-requests/incoming/{userId}` - Get incoming friend requests
- `POST /api/friend-requests` - Send a friend request
- `PUT /api/friend-requests/{requestId}/accept` - Accept a friend request
- `PUT /api/friend-requests/{requestId}/reject` - Reject a friend request

## Data Storage

Data is stored in JSON files in the `data/` directory:
- `codes.json` - Code files
- `users.json` - User accounts
- `passwords.json` - User passwords (plain text - should be hashed in production)
- `friends.json` - Friends relationships
- `messages.json` - Messages
- `friendRequests.json` - Friend requests

## Development

The server runs on `http://localhost:3000` by default (configurable via PORT environment variable).

API documentation is available at:
- Swagger UI: `http://localhost:3000/docs`
- ReDoc: `http://localhost:3000/redoc`
