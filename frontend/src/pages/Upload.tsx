import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadModal from '../components/modals/UploadModal';
import './Upload.css';

const Upload: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(true);
  const navigate = useNavigate();

  // Жабылғанда — жүктеу басылған бетке қайту (тарих жоқ болса — басты бетке).
  // «Жобаны ашу» басылса, модал алдымен жобаға өтеді — онда артқа қайтпаймыз.
  const handleClose = () => {
    setIsModalOpen(false);
    if (!window.location.pathname.endsWith('/upload')) return;
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="upload-page">
      <UploadModal isOpen={isModalOpen} onClose={handleClose} />
    </div>
  );
};

export default Upload;
