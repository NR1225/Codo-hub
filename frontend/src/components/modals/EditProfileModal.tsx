
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { User } from '../../utils/api';
import { apiService } from '../../utils/api';
import { imageStorage } from '../../utils/imageStorage';
import Button from '../ui/Button';
import './EditProfileModal.css';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUpdate: (updatedUser: User) => void;
}

const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdate,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    username: user.username,
    email: user.email,
    avatar: user.avatar || '',
    bio: user.bio || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioSaving, setBioSaving] = useState(false);
  const [originalBio, setOriginalBio] = useState<string>(user.bio || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Scroll to top when modal opens
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
      // Load avatar from imageStorage if it exists
      const loadAvatar = async () => {
        let avatarToUse = user.avatar || '';
        
        // If avatar is 'stored' flag, load from imageStorage
        if (user.avatar === 'stored' && user.id) {
          try {
            const avatarFromStorage = await imageStorage.getImage(`avatar-${user.id}`);
            if (avatarFromStorage) {
              avatarToUse = avatarFromStorage;
            } else {
              avatarToUse = '';
            }
          } catch (err) {
            avatarToUse = '';
          }
        }
        
        setFormData({
          username: user.username,
          email: user.email,
          avatar: avatarToUse,
          bio: user.bio || '',
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        setOriginalBio(user.bio || '');
        setAvatarPreview(avatarToUse || null);
        setError(null);
        setBioSaving(false);
      };
      
      loadAvatar();
    }
  }, [isOpen, user.id, user.avatar, user.bio, user.username, user.email]);

  // Update username, email, and bio when user changes, but preserve avatarPreview state
  useEffect(() => {
    if (isOpen) {
      setFormData((prev) => ({
        ...prev,
        username: user.username,
        email: user.email,
        bio: user.bio || '',
      }));
      // Update original bio when user prop changes (after save)
      setOriginalBio(user.bio || '');
    }
  }, [isOpen, user.username, user.email, user.bio]);

  const compressImage = (file: File, maxWidth: number = 800, quality: number = 0.8): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          
          try {
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
          } catch (err) {
            reject(new Error('Image compression failed'));
          }
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError(t('editProfile.onlyImageFiles'));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Validate file size (max 10MB before compression)
    if (file.size > 10 * 1024 * 1024) {
      setError(t('editProfile.imageSizeLimit'));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    try {
      // Compress and convert to base64
      const compressedBase64 = await compressImage(file);
      
      // Check compressed size (max 2MB base64)
      if (compressedBase64.length > 2 * 1024 * 1024) {
        // Try with lower quality
        const moreCompressed = await compressImage(file, 600, 0.6);
        setFormData((prev) => ({ ...prev, avatar: moreCompressed }));
        setAvatarPreview(moreCompressed);
        console.log('Image compressed to:', (moreCompressed.length / 1024).toFixed(2), 'KB');
      } else {
        setFormData((prev) => ({ ...prev, avatar: compressedBase64 }));
        setAvatarPreview(compressedBase64);
        console.log('Image compressed to:', (compressedBase64.length / 1024).toFixed(2), 'KB');
      }
      
      setError(null);
    } catch (err) {
      console.error('Error processing image:', err);
      setError(err instanceof Error ? err.message : t('editProfile.imageProcessingError'));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAvatar = () => {
    // Only update local state, don't save until user clicks "Save"
    setFormData((prev) => ({ ...prev, avatar: '' }));
    setAvatarPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBioSave = async () => {
    // Only save if bio has changed
    if (formData.bio.trim() === originalBio.trim()) {
      return;
    }

    setBioSaving(true);
    setError(null);

    try {
      // Only send bio field - preserve all other fields from current user
      const updateData: Partial<User> & { userId?: string; currentEmail?: string } = {
        username: user.username, // Keep current username (required for identification)
        email: user.email, // Keep current email (required for identification)
        bio: formData.bio.trim() || undefined, // ONLY update bio - this is the only field that changes
        userId: user.id,
        currentEmail: user.email,
        // Don't include avatar - we're only saving bio, not changing avatar
      };

      const updatedUser = await apiService.updateUserProfile(updateData);
      
      // Update localStorage - only update bio, keep everything else
      const { avatar, ...userWithoutAvatar } = updatedUser;
      const userForStorage = {
        ...userWithoutAvatar,
        bio: updatedUser.bio || formData.bio || undefined,
        avatar: avatar ? 'stored' : undefined
      };
      
      try {
        localStorage.setItem('user', JSON.stringify(userForStorage));
      } catch (err: any) {
        if (err.name === 'QuotaExceededError') {
          try {
            const { avatar: _, ...userMinimal } = userForStorage;
            localStorage.setItem('user', JSON.stringify(userMinimal));
          } catch (minimalErr) {
            console.error('Failed to save user to localStorage:', minimalErr);
          }
        }
      }

      // Update formData immediately to reflect saved state in textarea
      const savedBio = updatedUser.bio || formData.bio.trim() || '';
      setFormData((prev) => ({
        ...prev,
        bio: savedBio
      }));
      
      // Update original bio ref to reflect saved value
      setOriginalBio(savedBio);
      
      // Update parent component - only update bio, preserve all other fields exactly as they were
      const finalUser = {
        ...user, // Start with current user data (preserves avatar, username, email, etc.)
        bio: updatedUser.bio || formData.bio || undefined, // ONLY update bio field
      };
      
      window.dispatchEvent(new CustomEvent('userProfileUpdated'));
      onUpdate(finalUser);
      
      // Don't close modal - stay in profile edit section
      // The save button will disappear since bio no longer has changes
      // The textarea will show the saved value immediately
    } catch (err: any) {
      console.error('Error saving bio:', err);
      let errorMessage = err instanceof Error ? err.message : t('editProfile.bioSaveError');
      
      if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('табылмады')) {
        setError(t('editProfile.userNotFound'));
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        setError(t('editProfile.serverConnectionError'));
      } else {
        setError(errorMessage);
      }
    } finally {
      setBioSaving(false);
    }
  };

  const hasBioChanged = formData.bio.trim() !== originalBio.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Update profile
      const updateData: Partial<User> & { userId?: string; currentEmail?: string } = {
        username: formData.username,
        email: formData.email,
        bio: formData.bio || undefined,
        userId: user.id, // Send user ID to help backend find the user
        currentEmail: user.email, // Send current email as backup
      };

      // Always include avatar - send undefined if empty (to remove avatar), or the base64 string
      if (formData.avatar && formData.avatar.trim() !== '') {
        updateData.avatar = formData.avatar;
      } else {
        updateData.avatar = undefined; // Explicitly set to undefined to remove avatar
      }

      const updatedUser = await apiService.updateUserProfile(updateData);

      // Save avatar separately using imageStorage if present
      if (formData.avatar && formData.avatar.trim() !== '') {
        try {
          await imageStorage.saveImage(`avatar-${updatedUser.id}`, formData.avatar);
        } catch (err: any) {
          console.error('Error saving avatar to imageStorage:', err);
          // Continue even if avatar save fails
        }
      } else {
        // Remove avatar if it was cleared
        try {
          await imageStorage.removeImage(`avatar-${updatedUser.id}`);
        } catch (err) {
          // Ignore errors when removing
        }
      }

      // Update localStorage without avatar (to avoid quota issues)
      // Remove avatar from user object before saving to localStorage
      const { avatar, ...userWithoutAvatar } = updatedUser;
      const userForStorage = {
        ...userWithoutAvatar,
        bio: updatedUser.bio || formData.bio || undefined, // Ensure bio is included
        avatar: avatar ? 'stored' : undefined // Just a flag, not the actual image
      };
      
      try {
        localStorage.setItem('user', JSON.stringify(userForStorage));
      } catch (err: any) {
            // If still quota exceeded, try without avatar flag
            if (err.name === 'QuotaExceededError') {
              console.warn('Quota exceeded, trying to save user without avatar flag');
              try {
                const { avatar: _, ...userMinimal } = userForStorage;
                localStorage.setItem('user', JSON.stringify(userMinimal));
              } catch (minimalErr: any) {
                // If still fails, show error to user
                setError(t('editProfile.storageQuotaExceeded'));
                setLoading(false);
                return;
              }
            } else {
              throw err;
            }
      }

      // Load avatar from imageStorage for the updated user object
      let finalUser = { ...updatedUser };
      if (formData.avatar && formData.avatar.trim() !== '') {
        finalUser.avatar = formData.avatar;
      } else {
        finalUser.avatar = undefined;
      }
      
      // Ensure bio is included in finalUser
      finalUser.bio = updatedUser.bio || formData.bio || undefined;

      // Dispatch custom event to notify Header component
      window.dispatchEvent(new CustomEvent('userProfileUpdated'));

      onUpdate(finalUser);
      onClose();
    } catch (err: any) {
      console.error('Error updating profile:', err);
      
      // Handle quota exceeded error
      if (err.name === 'QuotaExceededError' || err.message?.includes('quota') || err.message?.includes('exceeded')) {
        setError(t('editProfile.storageQuotaExceededAvatar'));
        setLoading(false);
        return;
      }
      
      // If user not found, clear localStorage and redirect to login
      if (err?.message?.includes('User not found') || err?.message?.includes('Пайдаланушы табылмады')) {
        localStorage.removeItem('user');
        window.dispatchEvent(new CustomEvent('userProfileUpdated'));
        alert(t('editProfile.userNotFound'));
        window.location.reload();
        return;
      }
      let errorMessage = err instanceof Error ? err.message : t('editProfile.updateError');
      
      // Remove password-related error message for profile updates (not password changes)
      if (errorMessage.includes('Пайдаланушы табылмады немесе құпия сөз дұрыс емес')) {
        errorMessage = t('editProfile.userNotFound');
      }
      
      // Show more specific error messages
      if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('табылмады')) {
        setError(t('editProfile.userNotFound'));
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        setError(t('editProfile.serverConnectionError'));
      } else if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
        setError(t('editProfile.invalidData'));
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('editProfile.title')}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="edit-profile-form">
          <div className="form-group avatar-group">
            <div className="avatar-upload-container">
              <div 
                className="avatar-preview"
                onClick={() => fileInputRef.current?.click()}
                title={t('editProfile.selectPhoto')}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" />
                ) : (
                  <div className="avatar-placeholder">
                    {formData.username.charAt(0).toUpperCase()}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                  id="avatar-upload"
                />
              </div>
              <div className="avatar-actions">
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="btn-remove-avatar"
                  >
                    <FontAwesomeIcon icon={faTrash} /> {t('editProfile.removeAvatar')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="form-group">
            <input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder={t('editProfile.username')}
              required
            />
          </div>

          <div className="form-group">
            <input
              id="email"
              type="email"
              value={formData.email}
              readOnly
              placeholder="email@example.com"
              required
            />
          </div>

          <div className="form-group">
              <textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder={t('editProfile.bioPlaceholder')}
                rows={1}
                maxLength={500}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  minHeight: '40px',
                  maxHeight: '100px',
                  lineHeight: '1.4'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent-color)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border-color)';
                }}
              />
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                marginTop: '0.25rem',
                textAlign: 'right'
              }}>
                {formData.bio.length} / 500 {t('editProfile.characters')}
              </div>
              {hasBioChanged && (
                <div style={{ marginTop: '0.5rem' }}>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleBioSave();
                    }}
                    variant="primary"
                    disabled={bioSaving}
                    style={{
                      minWidth: '80px',
                      height: '32px',
                      fontSize: '0.8rem',
                      padding: '0.25rem 0.75rem'
                    }}
                  >
                    {bioSaving ? t('editProfile.saving') : t('editProfile.save')}
                  </Button>
                </div>
              )}
            </div>

          {error && (
            <div className="form-error">
              {error}
            </div>
          )}

          <div className="form-actions">
            <Button type="button" onClick={onClose} variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t('editProfile.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProfileModal;