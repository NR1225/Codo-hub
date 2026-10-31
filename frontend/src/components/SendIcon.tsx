import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';

/** Сайттағы барлық «Жіберу» батырмаларына ортақ белгі — қағаз ұшақ (пікір, сторис, чат, ЖИ) */
const SendIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <FontAwesomeIcon icon={faPaperPlane} style={{ fontSize: size }} aria-hidden="true" />
);

export default SendIcon;
