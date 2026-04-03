import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import bridge from '../../bridge';
import { validateProfileName } from '../../utils/profileValidation';
import { Select } from '../Select/Select';
import { PttKeyCapture } from './PttKeyCapture';
import { themes } from '../../themes/theme-registry';
import { applyTheme } from '../../themes/theme-loader';
import brmbleLogo from '../../assets/brmble-logo.svg';
// mumble-seeklogo.svg removed — Mumble cards now use inline MumbleIcon SVG
import './OnboardingWizard.css';

// ── Card avatar icons (inline SVGs matching Avatar.tsx for theme compat) ──

/** Mumble headset icon — structural paths extracted from mumble-seeklogo.svg. */
function MumbleCardIcon() {
  return (
    <span className="onboarding-identity-card-icon-svg">
      <svg width="28" height="28" viewBox="120 185 1030 1090" aria-hidden="true">
        <path fill="currentColor" d="M480.363 187.477c-83.218-2.079-167.519 53.017-188.549 135.459-4.897 19.986-6.895 38.935-7.25 58.235v214.778h84.396c.298-75.558-.428-150.712.574-226.423 2.597-48.083 39.745-98.771 91.313-98.183.376 76.525-.776 153.097.605 229.592 4.398 62.203 63.338 113.686 125.728 108.411 38.976-.946 78.245 2.271 116.967-2.447 58.959-11.054 99.764-71.104 94.281-129.797V271.659c53.637-3.917 94.311 48.149 96.689 98.183.996 75.711.279 150.874.574 226.423h84.396V368.397c-2.764-24.563-6.656-54.621-19.969-78.313-34.529-70.053-115.293-107.852-191.467-102.157-22.25-2.826-46.188 12.22-52.281 33.308.367 90.265.629 180.561-.051 270.809-2.543 37.809-39.803 66.719-76.984 61.92-26.305 1.143-56.02.045-73.958-22.557-24.18-25.557-16.079-62.134-17.498-93.888.063-73.319-.242-146.573.42-219.767-11.001-22.251-35.457-33.736-59.684-30.084l-4.009-.055-4.243-.136z" />
        <path fill="currentColor" opacity="0.85" d="M938.947 581.866v571.777c112.938-12.39 201.703-135.639 201.703-285.889 0-150.252-88.766-273.501-201.703-285.888zM324.458 584.902v571.78c-112.938-12.389-201.704-135.642-201.704-285.889 0-150.252 88.765-273.5 201.704-285.891zM734.249 1210.855c.023 29.834-41.523 54.025-92.795 54.041-51.271.013-92.85-24.163-92.875-53.99v-.051c-.021-29.826 41.522-54.021 92.795-54.033 51.271-.014 92.854 24.155 92.875 53.989v.044z" />
        <path fill="currentColor" opacity="0.85" d="M902.665 572.616h18.629c7.201 0 13.041 5.35 13.041 11.95v556.565c0 6.604-5.84 11.953-13.041 11.953h-18.629c-7.203 0-13.043-5.351-13.043-11.953V584.566c0-6.6 5.84-11.95 13.043-11.95z" />
        <path fill="currentColor" opacity="0.85" d="M340.982 575.973h18.257c7.062 0 12.782 5.351 12.782 11.951v556.603c0 6.6-5.721 11.948-12.782 11.948h-18.257c-7.058 0-12.779-5.35-12.779-11.948V587.925c0-6.601 5.722-11.952 12.779-11.952z" />
      </svg>
    </span>
  );
}

/** Brmble berry/cluster icon — all paths from brmble-logo.svg. */
function BrmbleCardIcon() {
  return (
    <span className="onboarding-identity-card-icon-svg brmble-card-icon">
      <svg width="28" height="28" viewBox="108 118 820 820" aria-hidden="true">
        <path fill="currentColor" d="M485.187 326.648C504.701 325.902 526.761 326.778 546.825 326.529C554.663 331.202 585.925 365.575 593.576 374.068C593.661 385.237 592.933 396.151 593.243 407.337C593.572 419.237 593.361 431.105 593.713 443.037C591.843 445.975 589.836 448.323 587.374 450.777C574.198 463.912 561.815 478.001 548.349 490.833C538.744 491.419 524.637 490.753 514.653 490.896C507.038 491.005 491.665 491.337 484.69 490.676C480.208 487.2 473.4 479.237 469.205 474.93C459.732 465.203 450.167 454.79 440.021 445.76C439.839 442.937 439.949 440.051 440.015 437.22C440.515 415.791 439.496 394.255 440.096 372.839C442.671 369.336 446.956 365.174 450.063 361.962L470.122 341.612C473.534 338.141 481.726 328.993 485.187 326.648Z" />
        <path fill="currentColor" d="M468.403 507.856C470.293 509.378 472.682 512.248 474.365 514.127C484.481 514.504 494.511 514.1 504.624 514.517C508.925 529.579 513.634 549.16 517.275 564.583C519.752 558.004 522.309 545.963 524.063 538.8C525.668 532.248 528.997 520.059 529.769 513.74C537.433 513.088 549.309 513.5 557.594 513.326C559.499 511.573 561.454 509.875 563.455 508.233C570.976 512.614 587.778 531.257 593.913 538.257C593.233 561.442 593.193 584.641 593.794 607.828C591.352 610.686 587.811 614.192 585.157 616.978C573.849 627.692 559.462 644.891 548.204 654.379C543.764 655.219 490.236 655.357 485.268 654.323C480.341 650.542 467.022 636.046 462.057 630.974C456.885 625.689 443.315 612.775 439.986 607.697L440.076 536.732C449.592 527.189 458.911 517.261 468.403 507.856Z" />
        <path fill="currentColor" d="M629.689 465.743C631.134 465.784 633.125 465.968 634.469 466.519C661.238 477.491 688.902 486.067 715.63 497.193C718.569 498.416 720.755 499.295 723.544 500.838L724.138 501.16C731.063 514.35 733.58 548.577 738.886 563.751C739.521 565.567 742.731 572.867 742.59 575.362C724.634 595.899 704.442 615.762 685.867 635.911C683.942 637.998 681.297 639.905 679.922 640.888C675.201 640.211 665.206 636.62 660.167 634.999C652.822 632.698 645.43 630.549 637.995 628.556C633.912 627.423 614.472 622.961 612.133 621.713C612.397 619.638 614.552 618.585 616.243 617.519C615.677 601.905 616.011 584.83 616.034 569.103C625.699 567.896 640.531 565.857 649.97 565.352L652.839 564.913L652.945 564.511L650.959 563.743C645.541 561.275 638.058 559.173 632.213 557.156C627.641 555.578 621.573 553.207 617.1 551.89C616.818 544.516 617.332 535.568 616.548 528.637C610.099 520.264 596.724 509.626 592.127 503.171C601.496 493.524 612.086 484.674 621.306 474.787C623.632 472.294 627.836 468.401 629.689 465.743Z" />
        <path fill="currentColor" d="M309.127 501.191C316.242 497.038 344.592 487.643 353.223 484.609C367.702 479.52 388.919 470.064 403.178 466.377C411.019 472.531 419.063 482.184 425.936 489.666C430.552 494.69 435.52 499.498 439.992 504.403C432.844 512.411 424.078 520.491 416.537 528.489C416.466 537.436 417.246 552.339 416.444 560.492C405.48 564.984 393.82 569.461 383.092 574.342C381.597 574.943 380.292 575.152 379.467 576.227C380.593 576.894 380.756 576.769 382.101 576.856C387.777 577.594 412.901 578.847 415.794 581.13C416.67 581.822 417.08 582.898 417.157 583.988C417.339 586.574 416.773 589.369 416.692 591.986C416.426 600.565 416.107 609.629 417.41 618.13C418.838 619.614 420.026 620.402 420.336 622.156C416.076 624.913 385.291 631.824 377.948 634.083C372.822 635.66 359.08 640.186 354.22 641.397C346.174 634.22 337.384 623.389 329.662 615.554C317.013 602.72 304.555 589.698 291.742 577.022C294.963 561.915 298.951 546.149 302.355 531.038C304.42 521.872 306.48 509.939 309.127 501.191Z" />
        <path fill="currentColor" d="M629.914 301.489C638.478 301.239 676.941 315.659 686.888 319.522C693.271 322.001 708.242 326.3 714.116 329.029C718.19 336.031 724.637 355.921 727.424 364.207L741.298 404.466C739.311 409.488 725.458 429.297 721.926 434.56C715.171 444.621 708.238 456.182 701.404 466.062C690.385 463.739 681.879 460.389 671.399 456.428C666.414 455.198 655.862 451.06 650.759 448.952C637.821 443.606 630.155 441.015 616.56 437.829C616.403 430.143 615.828 413.317 617.265 406.418C628.524 399.948 640.886 394.838 652.273 387.755C644.918 386.839 624.072 387.105 616.419 387.446L616.387 387.024C615.93 380.396 616.317 373.824 616.453 367.183C616.573 361.319 613.645 360.772 610.117 356.644C602.745 348.016 594.646 340.237 586.532 332.33C601.23 321.565 615.583 313.122 629.914 301.489Z" />
        <path fill="currentColor" d="M439.353 640.505C442.245 642.539 451.465 652.702 453.54 655.882C451.817 661.758 439.611 692.393 441.191 695.761C444.943 695.089 462.483 673.242 467.87 669.506C470.109 672.061 471.836 674.045 474.318 676.374C481.123 677.579 501.587 676.74 510.142 677.107C514.262 679.576 517.338 683.51 520.858 686.996C523.55 696.094 520.119 714.001 520.196 724.007C520.235 728.998 519.915 753.178 516.648 755.724C507.804 762.615 496.378 769.082 486.853 775.537C482.593 778.417 474.751 784.207 470.43 785.491C451.777 782.49 428.199 776.387 410.21 774.468C405.118 768.081 399.905 759.847 394.28 752.895C389.993 747.596 378.941 734.484 376.033 729.867C375.532 718.671 377.255 703.288 377.723 691.797C377.978 685.543 378.287 669.964 379.533 664.659C382.945 663.064 386.306 661.817 389.917 660.742C407.114 655.62 422.901 647.436 439.353 640.505Z" />
        <path fill="currentColor" d="M406.252 301.523C410.594 301.132 423.367 311.068 427.649 314.072C435.014 319.227 442.464 324.259 449.997 329.165C443.49 337.067 433.874 345.355 426.655 352.767C423.266 356.248 419.842 358.984 416.932 362.984C416.164 373.767 416.892 394.243 416.981 405.58C405.084 411.262 391.756 415.703 379.474 420.517C387.399 422.449 407.373 424.354 416.161 425.386L415.935 437.41C410.136 440.113 402.12 442.566 395.881 444.832C386.984 448.062 377.593 451.877 368.618 454.682C358.04 458.178 348.805 461.261 338.361 465.291C325.77 445.025 312.864 424.956 299.648 405.092C308.892 380.388 315.266 354.486 324.599 329.506C351.883 320.372 379.101 311.044 406.252 301.523Z" />
        <path fill="currentColor" d="M594.483 639.433C611.541 644.556 629.391 653.614 646.251 659.852C648.668 660.746 651.167 661.969 653.459 663.176C653.501 663.351 653.549 663.526 653.585 663.702C654.929 670.179 657.739 705.527 654.786 709.544C654.663 709.711 654.527 709.869 654.4 710.035C650 715.803 644.186 720.706 639.154 725.949C631.566 733.854 624.364 742.191 616.648 749.966C615.491 751.132 613.901 752.9 612.347 753.404C607.183 755.079 568.149 754.306 559.406 754.401C555.375 754.499 549.975 754.96 546.167 754.05C543.248 753.529 540.165 747.101 540.327 744.508C541.615 723.949 543.182 702.915 544.119 682.351C542.901 680.284 541.177 678.08 539.74 676.122C545.324 675.95 552.55 676.422 558.37 676.546C560.693 673.836 562.845 671.294 565.342 668.738C569.955 673.036 574.705 677.608 579.109 682.113C583.95 687.066 587.701 691.743 593.109 696.157C591.215 687.154 583.169 661.977 579.704 653.695C585.675 649.613 589.394 644.483 594.483 639.433Z" />
        <path fill="currentColor" d="M516.267 142.323C518.579 144.477 525.623 177.433 526.992 182.766C535.029 184.301 543.045 187.172 550.975 188.874C561.453 191.123 565.34 195.33 571.544 203.686C574.349 207.463 576.985 210.632 579.375 214.744L573.96 218.079C568.333 229.795 564.212 254.919 558.393 266.071C545.472 266.019 532.773 265.478 519.625 265.514C509.705 265.317 487.05 266.481 478.625 264.777C473.387 249.086 468.034 233.433 462.566 217.82C460.369 217.159 456.688 216.391 455.078 215.088C455.311 211.843 469.203 194.234 472.452 191.461C485.633 189.197 493.761 185.669 506.1 182.894C510.025 169.116 512.655 156.136 516.267 142.323Z" />
        <path fill="currentColor" d="M309.303 261.536C314.651 261.068 350.41 275.974 357.431 277.67C364.978 279.494 367.954 283.776 372.31 289.754C366.158 291.352 358.042 294.384 351.835 296.447C336.446 301.563 321.637 306.811 305.881 310.842C302.387 320.695 298.943 334.17 295.63 344.615C285.716 344.044 270.596 341.015 259.844 339.71C268.94 346.065 280.515 353.522 289.055 360.215C286.752 372.711 279.126 393.13 275.299 405.934C276.019 407.893 276.521 408.905 276.691 410.958C275.718 412.55 275.86 412.1 273.813 413.037C268.547 415.13 258.333 417.019 252.544 418.232C243.959 397.422 232.305 376.968 224.09 356.149C226.085 351.376 228.904 347.76 231.587 343.266C223.075 337.719 202.424 322.991 195.853 315.869L196.26 315.912C208.38 317.249 227.996 321.8 239.918 324.806C243.049 316.51 254.037 293.655 254.555 286.57C257.409 285.005 259.967 284.249 263.01 283.166C279.125 277.432 293.95 268.845 309.303 261.536Z" />
        <path fill="currentColor" d="M726.649 261.011C735.253 262.548 771.932 283.235 781.817 287.224C783.864 288.05 797.242 319.832 799.425 324.788C809.489 322.385 835.31 315.614 844.323 315.315L843.65 316.055C838.395 321.884 815.745 338.489 808.463 343.741C810.352 348.57 812.234 353.294 815.055 357.657C809.31 365.703 790.526 415.06 785.986 418.561C780.737 419.795 772.446 416.526 767.504 414.496C765.414 413.861 762.977 413.588 762.018 411.597C762.636 409.8 764.097 408.897 765.588 407.668C765.16 406.549 764.738 405.432 764.551 404.247C763.503 397.642 760.81 391.254 758.664 384.874C755.991 377.004 753.457 369.088 751.062 361.129C758.869 355.949 773.089 343.177 780.534 339.445C768.432 341.826 756.475 342.549 745.035 344.694C741.371 333.387 737.599 322.114 733.721 310.878C710.882 304.912 687.563 295.499 664.399 288.712C665.261 286.838 666.242 284.896 667.146 283.03C675.973 278.051 691.816 273.954 701.834 270.241C709.344 267.458 719.305 263.226 726.649 261.011Z" />
        <path fill="currentColor" d="M752.125 597.795C756.604 602.666 763.934 619.001 767.721 625.603C770.667 630.74 773.067 634.56 776.417 639.618C773.489 647.691 771.514 656.027 769.138 664.268C766.873 672.125 764.336 679.903 762.085 687.765C760.472 693.397 759.224 699.317 757.159 704.797C756.543 706.432 755.813 707.973 754.519 709.182C750.198 713.216 731.759 724.605 725.983 726.684C722.393 727.976 683.682 732.553 678.263 732.491L677.408 731.466C676.87 727.271 673.079 722.028 676.27 719.429C677.751 718.539 677.9 718.463 679.242 717.237C679.641 712.31 678.865 704.873 678.661 699.698C678.202 688.029 677.195 675.692 677.425 664.047C682.373 664.702 683.14 664.515 687.76 666.166C692.586 660.857 697.46 655.591 702.38 650.369C710.998 654.449 724.122 664.093 734.567 669.584C732.593 663.551 719.651 643.425 715.583 635.857C724.105 626.934 732.853 618.27 741.304 609.301C744.945 605.437 748.306 601.527 752.125 597.795Z" />
        <path fill="currentColor" d="M535.255 774.363C537.989 777.469 540.205 802.278 542.781 808.505C544.788 809.974 546.613 811.579 548.514 813.181C560.017 822.872 571.794 832.059 584.287 840.429C583.841 841.758 580.793 850.432 579.746 851.326C571.574 858.306 554.054 868.66 544.993 873.895C542.831 875.143 528.675 873.362 525.101 875.501C523.745 878.256 523.627 881.687 522.919 884.704C520.77 893.868 518.93 903.08 517.182 912.327C516.939 913.617 516.64 914.465 515.556 915.144C513.016 912.658 507.716 881.515 505.936 875.483L505.265 875.44C501.626 875.103 492.48 875.568 489.605 874.66C480.062 871.647 453.852 855.265 448.81 847.715C448.876 845.495 449.322 842.418 449.583 840.147C465.289 827.554 480.621 816.361 495.722 802.579C502.069 814.195 506.408 825.845 513.253 837.782C513.758 827.686 514.414 817.596 514.889 807.497C515.178 801.348 515.011 795.159 515.491 789.053C521.605 783.952 528.786 779.277 535.255 774.363Z" />
        <path fill="currentColor" d="M280.581 596.262C297.168 615.075 315.111 634.434 333.467 651.473C330.597 664.769 326.159 678.831 323.025 692.729C325.942 689.851 329.515 686.362 331.925 683.132C336.219 677.379 338.895 672.581 344.077 667.42C347.984 666.548 352.449 665.912 356.452 665.964C355.794 670.683 355.901 677.087 355.49 682.075C354.098 698.967 353.947 715.703 352.38 732.584C343.799 732.47 332.392 730.213 323.497 729.333C320.353 728.999 311.065 727.935 308.365 726.876C299.891 723.553 290.942 718.1 282.473 714.412C276.874 711.973 274.9 705.487 273.079 700.204C267.663 702.217 257.423 704.386 251.723 705.655C243.649 707.441 235.612 709.392 227.617 711.509C234.979 706.31 242.779 699.553 249.901 693.907C255.145 689.751 261.948 684.76 266.759 680.363C267.524 677.673 258.026 647.256 256.73 641.602C259.67 635.376 264.257 627.626 267.638 621.458C272.177 613.177 276.493 604.775 280.581 596.262Z" />
        <path fill="currentColor" d="M406.252 301.523C410.594 301.132 423.367 311.068 427.649 314.072C435.014 319.227 442.464 324.259 449.997 329.165C443.49 337.067 433.874 345.355 426.655 352.767C423.266 356.248 419.842 358.984 416.932 362.984C416.164 373.767 416.892 394.243 416.981 405.58C405.084 411.262 391.756 415.703 379.474 420.517C387.399 422.449 407.373 424.354 416.161 425.386L415.935 437.41C410.136 440.113 402.12 442.566 395.881 444.832C386.984 448.062 377.593 451.877 368.618 454.682C358.04 458.178 348.805 461.261 338.361 465.291C325.77 445.025 312.864 424.956 299.648 405.092C308.892 380.388 315.266 354.486 324.599 329.506C351.883 320.372 379.101 311.044 406.252 301.523Z" />
      </svg>
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────

type WizardStep = 'welcome' | 'identity' | 'backup' | 'interface' | 'audio' | 'connection' | 'servers';

const STEPS: WizardStep[] = ['welcome', 'identity', 'backup', 'interface', 'audio', 'connection', 'servers'];

interface ScannedCert {
  source: 'brmble' | 'mumble-1.5' | 'mumble-1.4' | 'mumble-1.3';
  name: string;
  fingerprint: string;
  data: string; // base64 PKCS#12
  profileId?: string; // only for source "brmble"
  filename?: string;  // only for source "brmble" — on-disk filename
}

interface OnboardingWizardProps {
  onComplete: (fingerprint: string) => void;
  startAtPreferences?: boolean;
}

// ── Settings types (local copies to avoid SettingsModal coupling) ──

type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous';

interface WizardSettings {
  // Interface
  theme: string;
  brmblegotchiEnabled: boolean;
  // Audio
  inputDevice: string;
  outputDevice: string;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  speechDenoiseMode: 'rnnoise' | 'disabled';
  // Connection
  reconnectEnabled: boolean;
  rememberLastChannel: boolean;
  autoConnectEnabled: boolean;
}

const SETTINGS_STORAGE_KEY = 'brmble-settings';

function loadInitialSettings(): WizardSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        theme: parsed.appearance?.theme ?? 'classic',
        brmblegotchiEnabled: parsed.brmblegotchi?.enabled ?? true,
        inputDevice: parsed.audio?.inputDevice ?? 'default',
        outputDevice: parsed.audio?.outputDevice ?? 'default',
        transmissionMode: parsed.audio?.transmissionMode ?? 'pushToTalk',
        pushToTalkKey: parsed.audio?.pushToTalkKey ?? null,
        speechDenoiseMode: parsed.speechDenoise?.mode ?? 'rnnoise',
        reconnectEnabled: parsed.reconnectEnabled ?? true,
        rememberLastChannel: parsed.rememberLastChannel ?? true,
        autoConnectEnabled: parsed.autoConnectEnabled ?? false,
      };
    }
  } catch { /* ignore */ }
  return {
    theme: 'classic',
    brmblegotchiEnabled: true,
    inputDevice: 'default',
    outputDevice: 'default',
    transmissionMode: 'pushToTalk',
    pushToTalkKey: null,
    speechDenoiseMode: 'rnnoise',
    reconnectEnabled: true,
    rememberLastChannel: true,
    autoConnectEnabled: false,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function formatFingerprint(fp: string) {
  return fp;
}

function triggerBlobDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────

export function OnboardingWizard({ onComplete, startAtPreferences }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>(startAtPreferences ? 'interface' : 'welcome');
  const stepIndex = STEPS.indexOf(step);

  // Detection state
  const [detecting, setDetecting] = useState(false);
  const [discoveredCerts, setDiscoveredCerts] = useState<ScannedCert[]>([]);

  // Identity step state
  const [selectedIdentity, setSelectedIdentity] = useState<
    | { kind: 'brmble'; cert: ScannedCert }
    | { kind: 'mumble'; cert: ScannedCert }
    | { kind: 'new' }
    | null
  >(null);
  const [newName, setNewName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');

  // Backup step state
  const [fingerprint, setFingerprint] = useState('');
  const [exportError, setExportError] = useState('');

  // Preferences state
  const [settings, setSettings] = useState<WizardSettings>(loadInitialSettings);

  // Server import step state
  interface MumbleServer { label: string; host: string; port: number; username: string; alreadySaved: boolean; }
  const [mumbleServers, setMumbleServers] = useState<MumbleServer[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<number>>(new Set());
  const [serversImportBusy, setServersImportBusy] = useState(false);

  // Listen for bridge events
  useEffect(() => {
    const onProfileAdded = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setBusy(false);
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
        setStep('backup');
      }
    };
    const onActiveChanged = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setBusy(false);
      if (d?.fingerprint) {
        setFingerprint(d.fingerprint);
      }
      setStep('backup');
    };
    const onProfilesError = (data: unknown) => {
      const d = data as { message?: string } | undefined;
      setBusy(false);
      setIdentityError(d?.message ?? 'An error occurred. Please try again.');
    };
    const onExportData = (data: unknown) => {
      const d = data as { data?: string; filename?: string } | undefined;
      if (d?.data) triggerBlobDownload(d.data, d.filename ?? 'brmble-identity.pfx');
    };
    const onCertError = (data: unknown) => {
      const d = data as { message?: string } | undefined;
      setExportError(d?.message ?? 'Export failed. Please try again.');
    };
    const onDetectedServers = (data: unknown) => {
      const d = data as { servers?: MumbleServer[] } | undefined;
      const svrs = d?.servers ?? [];
      setMumbleServers(svrs);
      // Pre-select all servers except those already saved in Brmble
      setSelectedServers(new Set(svrs.reduce<number[]>((acc, srv, i) => {
        if (!srv.alreadySaved) acc.push(i);
        return acc;
      }, [])));
    };
    const onServersImported = () => {
      setServersImportBusy(false);
      onComplete(fingerprint);
    };

    bridge.on('profiles.added', onProfileAdded);
    bridge.on('profiles.activeChanged', onActiveChanged);
    bridge.on('profiles.error', onProfilesError);
    bridge.on('cert.exportData', onExportData);
    bridge.on('cert.error', onCertError);
    bridge.on('mumble.detectedServers', onDetectedServers);
    bridge.on('mumble.serversImported', onServersImported);

    return () => {
      bridge.off('profiles.added', onProfileAdded);
      bridge.off('profiles.activeChanged', onActiveChanged);
      bridge.off('profiles.error', onProfilesError);
      bridge.off('cert.exportData', onExportData);
      bridge.off('cert.error', onCertError);
      bridge.off('mumble.detectedServers', onDetectedServers);
      bridge.off('mumble.serversImported', onServersImported);
    };
  }, [fingerprint, onComplete]);

  // When detectedCerts arrives, advance to identity
  const setCertsAndAdvance = useCallback((certs: ScannedCert[]) => {
    setDiscoveredCerts(certs);
    setDetecting(false);
    setStep('identity');
  }, []);

  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { certs?: ScannedCert[] } | undefined;
      setCertsAndAdvance(d?.certs ?? []);
    };
    bridge.on('certs.scanned', handler);
    return () => bridge.off('certs.scanned', handler);
  }, [setCertsAndAdvance]);

  // ── Save settings to localStorage and bridge ───────────────────

  const saveSettings = useCallback((s: WizardSettings) => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const merged = {
        ...parsed,
        appearance: { ...(parsed.appearance ?? {}), theme: s.theme },
        brmblegotchi: { ...(parsed.brmblegotchi ?? {}), enabled: s.brmblegotchiEnabled },
        audio: {
          ...(parsed.audio ?? {}),
          inputDevice: s.inputDevice,
          outputDevice: s.outputDevice,
          transmissionMode: s.transmissionMode,
          pushToTalkKey: s.pushToTalkKey,
        },
        speechDenoise: { mode: s.speechDenoiseMode },
        reconnectEnabled: s.reconnectEnabled,
        rememberLastChannel: s.rememberLastChannel,
        autoConnectEnabled: s.autoConnectEnabled,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      bridge.send('settings.set', merged);
    } catch { /* ignore */ }
  }, []);

  const updateSettings = useCallback((patch: Partial<WizardSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  }, [saveSettings]);

  // ── Step handlers ──────────────────────────────────────────────

  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGetStartedWithTimer = () => {
    setDetecting(true);
    bridge.send('certs.scan');
    detectionTimerRef.current = setTimeout(() => {
      setDetecting(false);
      setStep('identity');
    }, 2000);
  };

  const handleIdentityContinue = () => {
    if (!selectedIdentity) return;
    setIdentityError('');
    setBusy(true);

    if (selectedIdentity.kind === 'brmble') {
      if (!selectedIdentity.cert.profileId) {
        setBusy(false);
        setIdentityError('This certificate is missing a profile ID. Please select another or create a new profile.');
        return;
      }
      bridge.send('profiles.setActive', { id: selectedIdentity.cert.profileId });
    } else if (selectedIdentity.kind === 'mumble') {
      bridge.send('profiles.import', {
        name: selectedIdentity.cert.name,
        data: selectedIdentity.cert.data,
      });
    } else {
      bridge.send('profiles.add', { name: newName.trim() });
    }
  };

  // Derived: cert groups and taken names (memoized to avoid repeated .filter() in JSX)
  const brmbleCerts = useMemo(() => discoveredCerts.filter(c => c.source === 'brmble'), [discoveredCerts]);
  const mumbleCerts = useMemo(() => discoveredCerts.filter(c => c.source.startsWith('mumble-')), [discoveredCerts]);
  const takenNames = useMemo(() => discoveredCerts.map(c => c.name.toLowerCase()), [discoveredCerts]);

  const newNameValidation = (() => {
    if (!newName.trim()) return null;
    const basic = validateProfileName(newName.trim());
    if (basic) return basic;
    if (takenNames.includes(newName.trim().toLowerCase())) {
      return 'This name is already taken by an existing identity.';
    }
    return null;
  })();

  const canCreateNew = selectedIdentity?.kind === 'new'
    && newName.trim().length > 0
    && newNameValidation === null
    && acknowledged;

  const canContinueIdentity = (() => {
    if (!selectedIdentity) return false;
    if (selectedIdentity.kind === 'brmble') return true;
    if (selectedIdentity.kind === 'mumble') return true;
    return canCreateNew;
  })();

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-panel glass-panel">

        {/* Progress dots */}
        <div className="onboarding-dots">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`onboarding-dot${i <= stepIndex ? ' active' : ''}`}
            />
          ))}
        </div>

        {/* ── Step 1: Welcome ── */}
        {step === 'welcome' && (
          <>
            <div className="onboarding-hero">
              <img src={brmbleLogo} alt="Brmble" className="onboarding-hero-logo" />
            </div>
            <h2 className="heading-title onboarding-title">Welcome to Brmble!</h2>
            <p className="onboarding-body">
              Brmble is a self-hosted, privacy-first platform for voice, chat and
              screen sharing.
            </p>

            <div className="onboarding-features">
              <div className="onboarding-feature">
                <div className="onboarding-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
                <span className="onboarding-feature-label">Voice</span>
              </div>
              <div className="onboarding-feature">
                <div className="onboarding-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <span className="onboarding-feature-label">Chat</span>
              </div>
              <div className="onboarding-feature">
                <div className="onboarding-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <span className="onboarding-feature-label">Screen share</span>
              </div>
            </div>

            <p className="onboarding-body">
              Instead of signing up the traditional way, Brmble uses a <strong>certificate</strong> to
              recognise who you are. There's no need for an email address or password.
              Choose your online name and generate your own certificate or import an
              existing one to get started!
            </p>

            <div className="onboarding-actions">
              <button className="btn btn-primary" onClick={handleGetStartedWithTimer}>
                Get Started
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Identity ── */}
        {step === 'identity' && (
          <>
            <div className="onboarding-hero">
              <div className="onboarding-step-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            </div>
            <h2 className="heading-title onboarding-title">Choose Your Profile</h2>

            {discoveredCerts.length > 0 ? (
              <p className="onboarding-body">
                We found existing certificates on this computer. Select one to use as your
                profile, or create a new one.
              </p>
            ) : (
              <p className="onboarding-body">
                Your profile name is what other users see when you connect to a server.
                Create one to get started.
              </p>
            )}

            {detecting && (
              <div className="onboarding-detecting">
                <div className="onboarding-spinner" />
                Scanning for existing certificates…
              </div>
            )}

            <div className="onboarding-identity-list">

              {/* Group 1: Brmble certificates found on disk */}
              {brmbleCerts.length > 0 && (
                <>
                  <div className="onboarding-identity-group-label">Your Brmble certificates</div>
                  {brmbleCerts.map(cert => (
                    <button
                      key={cert.fingerprint}
                      className={`onboarding-identity-card${selectedIdentity?.kind === 'brmble' && selectedIdentity.cert.fingerprint === cert.fingerprint ? ' selected' : ''}`}
                      onClick={() => setSelectedIdentity({ kind: 'brmble', cert })}
                    >
                      <BrmbleCardIcon />
                      <div className="onboarding-identity-card-body">
                        <div className="onboarding-identity-card-name">{cert.name}</div>
                        <div className="onboarding-identity-card-meta">
                          Fingerprint: {formatFingerprint(cert.fingerprint)}
                        </div>
                        {cert.filename && (
                          <div className="onboarding-identity-card-meta">
                            File: {cert.filename}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Group 2: Mumble certificates found on disk */}
              {mumbleCerts.length > 0 && (
                <>
                  <div className="onboarding-identity-group-label">Mumble certificates found</div>
                  {mumbleCerts.map(cert => {
                    const versionLabel = `Mumble ${cert.source.replace('mumble-', '')}`;
                    return (
                      <button
                        key={cert.fingerprint}
                        className={`onboarding-identity-card${selectedIdentity?.kind === 'mumble' && selectedIdentity.cert.fingerprint === cert.fingerprint ? ' selected' : ''}`}
                        onClick={() => setSelectedIdentity({ kind: 'mumble', cert })}
                      >
                        <MumbleCardIcon />
                        <div className="onboarding-identity-card-body">
                          <div className="onboarding-identity-card-name">{cert.name}</div>
                          <div className="onboarding-identity-card-meta">
                            Fingerprint: {formatFingerprint(cert.fingerprint)}
                          </div>
                          <div className="onboarding-identity-card-desc">
                            Import this {versionLabel} certificate to keep your username
                            and permissions on servers.
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {/* Group 3: Create new */}
              <div className="onboarding-identity-group-label">
                {discoveredCerts.length > 0 ? 'Or create a new one' : 'Get started'}
              </div>
              <button
                className={`onboarding-identity-card${selectedIdentity?.kind === 'new' ? ' selected' : ''}`}
                onClick={() => setSelectedIdentity({ kind: 'new' })}
              >
                <span className="onboarding-identity-card-icon-svg">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <div className="onboarding-identity-card-body">
                  <div className="onboarding-identity-card-name">Create a new profile</div>
                  <div className="onboarding-identity-card-desc">
                    Pick a name and generate a fresh certificate.
                  </div>
                </div>
              </button>
            </div>

            {/* Inline new identity form */}
            {selectedIdentity?.kind === 'new' && (
              <div className="onboarding-new-identity-form">
                <label htmlFor="onboarding-new-name">Profile name (your username on servers)</label>
                <input
                  id="onboarding-new-name"
                  className="brmble-input"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. YourName"
                  autoFocus
                />
                {newName.trim() && newNameValidation && (
                  <div className="onboarding-new-identity-error">{newNameValidation}</div>
                )}
              </div>
            )}

            {/* Inline warning + ack (only for new profile) */}
            {selectedIdentity?.kind === 'new' && (
              <>
                <div className="onboarding-inline-warning">
                  <strong>Starting fresh?</strong>
                  This will generate a brand-new certificate. If you previously used Mumble,
                  consider importing your existing certificate instead so you keep your
                  username and history on all servers.
                </div>
                <label className="onboarding-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={e => setAcknowledged(e.target.checked)}
                  />
                  <span>I understand — I want to create a new profile.</span>
                </label>
              </>
            )}

            {identityError && (
              <p className="onboarding-error">{identityError}</p>
            )}

            <div className="onboarding-actions">
              <button
                className="btn btn-primary"
                disabled={!canContinueIdentity || busy}
                onClick={handleIdentityContinue}
              >
                {busy ? 'Setting up…' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Backup ── */}
        {step === 'backup' && (
          <>
            <div className="onboarding-icon">💾</div>
            <h2 className="heading-title onboarding-title">Save a copy of your certificate</h2>
            <p className="onboarding-body">
              Your certificate is the only copy of your identity. If you lose this computer
              or reinstall Windows without a backup, there is no way to recover it — you
              would start over as a new user on every server.
            </p>
            <p className="onboarding-body">Suggested places to store your backup:</p>
            <ul className="onboarding-backup-locations">
              <li>OneDrive, Google Drive, Dropbox, or iCloud Drive</li>
              <li>A USB drive kept somewhere safe</li>
              <li>A password manager that supports file attachments</li>
            </ul>
            {fingerprint && (
              <div className="onboarding-fingerprint">{fingerprint}</div>
            )}
            {exportError && (
              <p style={{ color: 'var(--accent-danger-text)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-md)' }}>
                {exportError}
              </p>
            )}
            <div className="onboarding-actions">
              <button
                className="onboarding-skip-link"
                onClick={() => setStep('interface')}
              >
                Skip (Not Recommended)
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setExportError('');
                  bridge.send('cert.export');
                  setStep('interface');
                }}
              >
                Export &amp; Continue
              </button>
            </div>
          </>
        )}

        {/* ── Step 4: Interface ── */}
        {step === 'interface' && (
          <>
            <div className="onboarding-icon">🎨</div>
            <h2 className="heading-title onboarding-title">Interface</h2>
            <p className="onboarding-body">Customise how Brmble looks and feels.</p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label htmlFor="onboarding-theme">Theme</label>
                <Select
                  value={settings.theme}
                  onChange={v => updateSettings({ theme: v })}
                  options={themes.map(t => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="onboarding-pref-item">
                <label htmlFor="onboarding-gotchi">Show Brmblegotchi</label>
                <label className="brmble-toggle">
                  <input
                    id="onboarding-gotchi"
                    type="checkbox"
                    checked={settings.brmblegotchiEnabled}
                    onChange={e => updateSettings({ brmblegotchiEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <p className="onboarding-pref-hint">
                Brmblegotchi is a small virtual companion that lives in your sidebar.
              </p>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-skip-link" onClick={() => setStep('audio')}>
                Skip
              </button>
              <button className="btn btn-ghost" onClick={() => setStep('backup')}>Back</button>
              <button className="btn btn-primary" onClick={() => setStep('audio')}>Next</button>
            </div>
          </>
        )}

        {/* ── Step 5: Audio ── */}
        {step === 'audio' && (
          <>
            <div className="onboarding-icon">🎙️</div>
            <h2 className="heading-title onboarding-title">Audio</h2>
            <p className="onboarding-body">
              Configure your microphone and how your voice is transmitted.
            </p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Input device</label>
                <Select
                  value={settings.inputDevice}
                  onChange={v => updateSettings({ inputDevice: v })}
                  options={[{ value: 'default', label: 'Default' }]}
                />
              </div>
              <div className="onboarding-pref-item">
                <label>Output device</label>
                <Select
                  value={settings.outputDevice}
                  onChange={v => updateSettings({ outputDevice: v })}
                  options={[{ value: 'default', label: 'Default' }]}
                />
              </div>
            </div>

            <div className="onboarding-pref-section">
              <h3 className="heading-section onboarding-pref-section-title">Transmission mode</h3>
              <div className="onboarding-tx-cards">
                {(
                  [
                    { value: 'pushToTalk', label: 'Push to Talk', desc: 'Hold a key to transmit. Recommended for most users.' },
                    { value: 'voiceActivity', label: 'Voice Activity', desc: 'Transmit automatically when your mic detects speech.' },
                    { value: 'continuous', label: 'Continuous', desc: 'Always transmit. Not recommended unless you have a dedicated mic setup.' },
                  ] as { value: TransmissionMode; label: string; desc: string }[]
                ).map(opt => (
                  <button
                    key={opt.value}
                    className={`onboarding-tx-card${settings.transmissionMode === opt.value ? ' selected' : ''}`}
                    onClick={() => updateSettings({ transmissionMode: opt.value })}
                  >
                    <div>
                      <div className="onboarding-tx-card-label">{opt.label}</div>
                      <div className="onboarding-tx-card-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {settings.transmissionMode === 'pushToTalk' && (
                <div className="onboarding-pref-item" style={{ marginTop: 'var(--space-md)' }}>
                  <label>Push to Talk key</label>
                  <PttKeyCapture
                    value={settings.pushToTalkKey}
                    onChange={v => updateSettings({ pushToTalkKey: v })}
                  />
                </div>
              )}
            </div>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Noise suppression</label>
                <Select
                  value={settings.speechDenoiseMode}
                  onChange={v => updateSettings({ speechDenoiseMode: v as 'rnnoise' | 'disabled' })}
                  options={[
                    { value: 'rnnoise', label: 'RNNoise' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-skip-link" onClick={() => setStep('connection')}>
                Skip
              </button>
              <button className="btn btn-ghost" onClick={() => setStep('interface')}>Back</button>
              <button className="btn btn-primary" onClick={() => setStep('connection')}>Next</button>
            </div>
          </>
        )}

        {/* ── Step 6: Connection ── */}
        {step === 'connection' && (
          <>
            <div className="onboarding-icon">🌐</div>
            <h2 className="heading-title onboarding-title">Connection</h2>
            <p className="onboarding-body">
              Configure how Brmble connects and reconnects to servers.
            </p>

            <div className="onboarding-pref-section">
              <div className="onboarding-pref-item">
                <label>Automatically reconnect when disconnected</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.reconnectEnabled}
                    onChange={e => updateSettings({ reconnectEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <div className="onboarding-pref-item">
                <label>Rejoin last voice channel on connect</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.rememberLastChannel}
                    onChange={e => updateSettings({ rememberLastChannel: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              <div className="onboarding-pref-item">
                <label>Auto-connect on startup</label>
                <label className="brmble-toggle">
                  <input
                    type="checkbox"
                    checked={settings.autoConnectEnabled}
                    onChange={e => updateSettings({ autoConnectEnabled: e.target.checked })}
                  />
                  <span className="brmble-toggle-slider" />
                </label>
              </div>
              {settings.autoConnectEnabled && (
                <p className="onboarding-pref-hint">
                  Once you have added a server, Brmble can connect to it automatically when
                  you launch the app. You can choose which server in Settings → Connection.
                </p>
              )}
            </div>

            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('audio')}>Back</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  bridge.send('mumble.detectServers');
                  setStep('servers');
                }}
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* ── Step 7: Import Servers ── */}
        {step === 'servers' && (
          <>
            <div className="onboarding-icon">🖥️</div>
            <h2 className="heading-title onboarding-title">Import Your Servers</h2>

            {mumbleServers.length === 0 ? (
              <>
                <p className="onboarding-body">
                  No Mumble server favourites were found on this computer.
                </p>
                <div className="onboarding-actions">
                  <button className="btn btn-ghost" onClick={() => setStep('connection')}>Back</button>
                  <button className="btn btn-primary" onClick={() => onComplete(fingerprint)}>
                    Finish
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="onboarding-body">
                  We found your Mumble server favourites. Select the ones you want to add to
                  Brmble. Passwords are not imported.
                </p>
                <div className="onboarding-identity-list">
                  {mumbleServers.map((srv, i) => (
                    <button
                      key={i}
                      className={`onboarding-identity-card${selectedServers.has(i) ? ' selected' : ''}`}
                      onClick={() => setSelectedServers(prev => {
                        const next = new Set(prev);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })}
                    >
                      <span className="onboarding-identity-card-icon">🖥️</span>
                      <div className="onboarding-identity-card-body">
                        <div className="onboarding-identity-card-name">
                          {srv.label || srv.host}
                        </div>
                        <div className="onboarding-identity-card-meta">
                          {srv.host}:{srv.port}
                          {srv.username ? ` · ${srv.username}` : ''}
                        </div>
                      </div>
                      {srv.alreadySaved && !selectedServers.has(i)
                        ? <span className="onboarding-identity-badge saved">Already saved</span>
                        : selectedServers.has(i)
                          ? <span className="onboarding-identity-badge brmble">Import</span>
                          : null
                      }
                    </button>
                  ))}
                </div>
                <div className="onboarding-actions">
                  <button className="onboarding-skip-link" onClick={() => onComplete(fingerprint)}>
                    Skip
                  </button>
                  <button className="btn btn-ghost" onClick={() => setStep('connection')}>Back</button>
                  <button
                    className="btn btn-primary"
                    disabled={serversImportBusy}
                    onClick={() => {
                      if (selectedServers.size === 0) { onComplete(fingerprint); return; }
                      setServersImportBusy(true);
                      const toImport = [...selectedServers].map(i => mumbleServers[i]);
                      bridge.send('mumble.importServers', { servers: toImport });
                    }}
                  >
                    {serversImportBusy
                      ? 'Importing…'
                      : selectedServers.size === 0
                        ? 'Finish (skip import)'
                        : `Import ${selectedServers.size} server${selectedServers.size > 1 ? 's' : ''}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
