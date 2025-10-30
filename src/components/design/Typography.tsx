import React from 'react';
import { Text, TextProps, TextStyle } from 'react-native';
import { Colors } from '../../theme/colors';

type Variant = 'titleLarge' | 'titleMedium' | 'titleSmall' | 'body' | 'caption';

interface TypographyProps extends TextProps {
  variant?: Variant;
  children: React.ReactNode;
  color?: string;
}

const variantStyles: Record<Variant, TextStyle> = {
  titleLarge: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: 0.2
  },
  titleMedium: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28
  },
  titleSmall: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text.secondary
  },
  caption: {
    fontSize: 13,
    lineHeight: 16,
    color: Colors.text.muted
  }
};

const Typography: React.FC<TypographyProps> = ({
  variant = 'body',
  style,
  color = Colors.text.primary,
  children,
  ...textProps
}) => {
  return (
    <Text
      style={[
        variantStyles[variant],
        {
          color
        },
        style
      ]}
      {...textProps}
    >
      {children}
    </Text>
  );
};

export default Typography;
