import React from 'react';

/* Бүркіт ЖИ белгісі — сайт логосы (header-дегімен бірдей) */
const BurkitLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <img
    src="/logo.png"
    alt=""
    className="site-logo"
    width={size}
    height={size}
    draggable={false}
    style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
  />
);

export default BurkitLogo;
