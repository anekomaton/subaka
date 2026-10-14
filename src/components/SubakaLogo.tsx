import React from 'react';

interface SubakaLogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
}

export const SubakaLogo: React.FC<SubakaLogoProps> = ({
  className = 'w-6 h-6',
  alt = 'СУБАКА',
  ...props
}) => {
  return (
    <img
      src="/subaka-logo.svg"
      alt={alt}
      className={className}
      draggable={false}
      {...props}
    />
  );
};
