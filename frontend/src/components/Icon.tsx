import React from 'react';
import {
  ArrowUpRight,
  ArrowsClockwise,
  Bookmarks,
  Browser,
  ChatCircleText,
  Check,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  Cloud,
  CloudArrowUp,
  Code,
  Copy,
  Database,
  FileArrowUp,
  FileText,
  Files,
  GithubLogo,
  Globe,
  Graph,
  Info,
  Lightning,
  LinkSimple,
  ListMagnifyingGlass,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  PaperPlaneRight,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkle,
  Stack,
  ThumbsDown,
  ThumbsUp,
  Trash,
  TrayArrowDown,
  User,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';
import type { IconProps } from '@phosphor-icons/react';

const iconMap = {
  'arrow-up-right': ArrowUpRight,
  'arrows-clockwise': ArrowsClockwise,
  bookmarks: Bookmarks,
  browser: Browser,
  'chat-circle-text': ChatCircleText,
  check: Check,
  'check-circle': CheckCircle,
  'circle-notch': CircleNotch,
  'clock-counter-clockwise': ClockCounterClockwise,
  cloud: Cloud,
  'cloud-arrow-up': CloudArrowUp,
  code: Code,
  copy: Copy,
  database: Database,
  'file-arrow-up': FileArrowUp,
  'file-text': FileText,
  files: Files,
  'github-logo': GithubLogo,
  globe: Globe,
  graph: Graph,
  info: Info,
  lightning: Lightning,
  'link-simple': LinkSimple,
  'list-magnifying-glass': ListMagnifyingGlass,
  'magnifying-glass': MagnifyingGlass,
  microphone: Microphone,
  'microphone-slash': MicrophoneSlash,
  'paper-plane-right': PaperPlaneRight,
  plus: Plus,
  scissors: Scissors,
  'shield-check': ShieldCheck,
  sparkle: Sparkle,
  stack: Stack,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  trash: Trash,
  'tray-arrow-down': TrayArrowDown,
  user: User,
  warning: Warning,
  'warning-circle': WarningCircle,
} as const;

export type IconName = keyof typeof iconMap;

type AppIconProps = Omit<IconProps, 'children'> & {
  name: IconName;
  spin?: boolean;
};

export const AppIcon: React.FC<AppIconProps> = ({
  name,
  size = 18,
  weight = 'regular',
  className = '',
  spin = false,
  ...props
}) => {
  const Icon = iconMap[name] ?? WarningCircle;
  const classes = ['app-icon', spin ? 'animate-spin' : '', className].filter(Boolean).join(' ');

  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      size={size}
      weight={weight}
      className={classes}
      {...props}
    />
  );
};

type CircularIconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'neutral' | 'accent' | 'mint' | 'danger' | 'active';
  iconSize?: number;
  spin?: boolean;
};

const iconButtonSizes = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export const CircularIconButton = React.forwardRef<HTMLButtonElement, CircularIconButtonProps>(
  (
    {
      icon,
      label,
      size = 'md',
      tone = 'neutral',
      iconSize,
      spin = false,
      className = '',
      type = 'button',
      title,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      data-size={size}
      data-tone={tone}
      className={['circular-icon-button', className].filter(Boolean).join(' ')}
      {...props}
    >
      <AppIcon name={icon} size={iconSize ?? iconButtonSizes[size]} spin={spin} />
    </button>
  ),
);

CircularIconButton.displayName = 'CircularIconButton';
