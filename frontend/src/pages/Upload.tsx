import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadModal from '../components/modals/UploadModal';
import './Upload.css';

const Upload: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(true);
  const navigate = useNavigate();

  // Жүктелген соң — бірден жаңа жобаның бетіне
  const handleSuccess = (folderId: string) => {
    navigate(folderId ? `/view/${folderId}` : '/');
  };

  const handleClose = () => {
    setIsModalOpen(false);
    navigate('/');
  };

  return (
    <div className="upload-page">
      <UploadModal
        isOpen={isModalOpen}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default Upload;

