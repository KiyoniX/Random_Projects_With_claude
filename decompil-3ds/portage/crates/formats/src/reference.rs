//! Vecteurs de référence générés par `banc/pica/formats.py` (fichier produit par un script, ne pas éditer).

pub struct Reference {
    pub format: u32,
    pub width: usize,
    pub height: usize,
    pub seed: u64,
    pub hash: u64,
    pub pixels: &'static [(usize, [u8; 4])],
}

pub const REFERENCES: &[Reference] = &[
    Reference { format: 0, width: 16, height: 16, seed: 1016, hash: 0x1218EB2F89AC0D88, pixels: &[(0, [255, 201, 85, 249]), (85, [212, 9, 18, 56]), (255, [165, 200, 150, 137])] }, // RGBA8
    Reference { format: 0, width: 8, height: 24, seed: 1008, hash: 0x758648203A355424, pixels: &[(0, [89, 84, 151, 56]), (64, [42, 147, 179, 0]), (191, [70, 115, 237, 192])] }, // RGBA8
    Reference { format: 0, width: 13, height: 10, seed: 1013, hash: 0xD818CAB30767AD93, pixels: &[(0, [57, 67, 91, 40]), (43, [237, 227, 251, 184]), (129, [41, 252, 97, 254])] }, // RGBA8
    Reference { format: 1, width: 16, height: 16, seed: 1026, hash: 0xD577AC71C9841132, pixels: &[(0, [208, 113, 32, 255]), (85, [126, 0, 114, 255]), (255, [151, 171, 162, 255])] }, // RGB8
    Reference { format: 1, width: 8, height: 24, seed: 1018, hash: 0x8548473169B2436B, pixels: &[(0, [176, 3, 239, 255]), (64, [31, 199, 184, 255]), (191, [184, 57, 231, 255])] }, // RGB8
    Reference { format: 1, width: 13, height: 10, seed: 1023, hash: 0xE30EE2FF29FEE9C4, pixels: &[(0, [237, 41, 184, 255]), (43, [181, 173, 189, 255]), (129, [138, 2, 234, 255])] }, // RGB8
    Reference { format: 2, width: 16, height: 16, seed: 1036, hash: 0x202AD3E12606377D, pixels: &[(0, [231, 82, 198, 255]), (85, [214, 107, 107, 0]), (255, [181, 247, 132, 0])] }, // RGB5A1
    Reference { format: 2, width: 8, height: 24, seed: 1028, hash: 0x9AFBC5F8F7469A89, pixels: &[(0, [165, 57, 16, 0]), (64, [255, 90, 156, 0]), (191, [33, 255, 99, 255])] }, // RGB5A1
    Reference { format: 2, width: 13, height: 10, seed: 1033, hash: 0xBD3DEACFB9CD230B, pixels: &[(0, [173, 16, 239, 255]), (43, [49, 140, 82, 255]), (129, [115, 123, 206, 255])] }, // RGB5A1
    Reference { format: 3, width: 16, height: 16, seed: 1046, hash: 0xC219C95E366D07B1, pixels: &[(0, [107, 158, 255, 255]), (85, [0, 77, 239, 255]), (255, [198, 24, 140, 255])] }, // RGB565
    Reference { format: 3, width: 8, height: 24, seed: 1038, hash: 0x64C57C03ED6AEBCF, pixels: &[(0, [107, 105, 16, 255]), (64, [123, 134, 206, 255]), (191, [132, 150, 156, 255])] }, // RGB565
    Reference { format: 3, width: 13, height: 10, seed: 1043, hash: 0x972DCFEE98C8180B, pixels: &[(0, [99, 4, 33, 255]), (43, [49, 166, 148, 255]), (129, [198, 251, 74, 255])] }, // RGB565
    Reference { format: 4, width: 16, height: 16, seed: 1056, hash: 0xC1BBFAA828D90E14, pixels: &[(0, [51, 153, 68, 204]), (85, [34, 51, 0, 51]), (255, [238, 238, 153, 136])] }, // RGBA4
    Reference { format: 4, width: 8, height: 24, seed: 1048, hash: 0xF098B2B9440EC682, pixels: &[(0, [136, 85, 85, 187]), (64, [51, 170, 0, 102]), (191, [187, 153, 102, 102])] }, // RGBA4
    Reference { format: 4, width: 13, height: 10, seed: 1053, hash: 0x535FE04B06ABE13A, pixels: &[(0, [102, 68, 34, 17]), (43, [187, 0, 17, 17]), (129, [85, 0, 119, 136])] }, // RGBA4
    Reference { format: 5, width: 16, height: 16, seed: 1066, hash: 0x8D2EC65F7765E5C1, pixels: &[(0, [116, 116, 116, 179]), (85, [149, 149, 149, 100]), (255, [30, 30, 30, 185])] }, // LA8
    Reference { format: 5, width: 8, height: 24, seed: 1058, hash: 0xE4A761099D56A440, pixels: &[(0, [113, 113, 113, 215]), (64, [215, 215, 215, 215]), (191, [154, 154, 154, 30])] }, // LA8
    Reference { format: 5, width: 13, height: 10, seed: 1063, hash: 0x3DA1BB075E0DF5FB, pixels: &[(0, [45, 45, 45, 110]), (43, [255, 255, 255, 124]), (129, [181, 181, 181, 210])] }, // LA8
    Reference { format: 6, width: 16, height: 16, seed: 1076, hash: 0xFC73377811918EF6, pixels: &[(0, [230, 191, 0, 255]), (85, [31, 120, 0, 255]), (255, [175, 235, 0, 255])] }, // HILO8
    Reference { format: 6, width: 8, height: 24, seed: 1068, hash: 0x98EC812DAA54593C, pixels: &[(0, [207, 116, 0, 255]), (64, [2, 190, 0, 255]), (191, [143, 171, 0, 255])] }, // HILO8
    Reference { format: 6, width: 13, height: 10, seed: 1073, hash: 0x73BCD833EDFBEFE2, pixels: &[(0, [215, 4, 0, 255]), (43, [198, 20, 0, 255]), (129, [143, 168, 0, 255])] }, // HILO8
    Reference { format: 7, width: 16, height: 16, seed: 1086, hash: 0x208BEE948BA7B413, pixels: &[(0, [71, 71, 71, 255]), (85, [194, 194, 194, 255]), (255, [22, 22, 22, 255])] }, // L8
    Reference { format: 7, width: 8, height: 24, seed: 1078, hash: 0xAA6E4EA6FEC97332, pixels: &[(0, [104, 104, 104, 255]), (64, [238, 238, 238, 255]), (191, [133, 133, 133, 255])] }, // L8
    Reference { format: 7, width: 13, height: 10, seed: 1083, hash: 0x71A314D205A64481, pixels: &[(0, [139, 139, 139, 255]), (43, [29, 29, 29, 255]), (129, [150, 150, 150, 255])] }, // L8
    Reference { format: 8, width: 16, height: 16, seed: 1096, hash: 0x50A325707204B83A, pixels: &[(0, [0, 0, 0, 127]), (85, [0, 0, 0, 133]), (255, [0, 0, 0, 238])] }, // A8
    Reference { format: 8, width: 8, height: 24, seed: 1088, hash: 0xC31B43B3158F9A86, pixels: &[(0, [0, 0, 0, 178]), (64, [0, 0, 0, 204]), (191, [0, 0, 0, 39])] }, // A8
    Reference { format: 8, width: 13, height: 10, seed: 1093, hash: 0x42980677098BEBDA, pixels: &[(0, [0, 0, 0, 30]), (43, [0, 0, 0, 24]), (129, [0, 0, 0, 180])] }, // A8
    Reference { format: 9, width: 16, height: 16, seed: 1106, hash: 0xD4D041D3E5958428, pixels: &[(0, [119, 119, 119, 153]), (85, [170, 170, 170, 51]), (255, [204, 204, 204, 221])] }, // LA4
    Reference { format: 9, width: 8, height: 24, seed: 1098, hash: 0x55BF6F3E32E67609, pixels: &[(0, [221, 221, 221, 34]), (64, [136, 136, 136, 102]), (191, [102, 102, 102, 0])] }, // LA4
    Reference { format: 9, width: 13, height: 10, seed: 1103, hash: 0xCC965C9BA21A2D9D, pixels: &[(0, [68, 68, 68, 153]), (43, [51, 51, 51, 119]), (129, [255, 255, 255, 221])] }, // LA4
    Reference { format: 10, width: 16, height: 16, seed: 1116, hash: 0xD9E96CBFC17B624F, pixels: &[(0, [68, 68, 68, 255]), (85, [102, 102, 102, 255]), (255, [153, 153, 153, 255])] }, // L4
    Reference { format: 10, width: 8, height: 24, seed: 1108, hash: 0xAB93903FB5D71798, pixels: &[(0, [85, 85, 85, 255]), (64, [68, 68, 68, 255]), (191, [204, 204, 204, 255])] }, // L4
    Reference { format: 10, width: 13, height: 10, seed: 1113, hash: 0x660177404C1806BE, pixels: &[(0, [255, 255, 255, 255]), (43, [221, 221, 221, 255]), (129, [170, 170, 170, 255])] }, // L4
    Reference { format: 11, width: 16, height: 16, seed: 1126, hash: 0xE4941377DAF0CF0F, pixels: &[(0, [0, 0, 0, 34]), (85, [0, 0, 0, 238]), (255, [0, 0, 0, 153])] }, // A4
    Reference { format: 11, width: 8, height: 24, seed: 1118, hash: 0x915B8172B00AF7C5, pixels: &[(0, [0, 0, 0, 102]), (64, [0, 0, 0, 136]), (191, [0, 0, 0, 136])] }, // A4
    Reference { format: 11, width: 13, height: 10, seed: 1123, hash: 0x914748B3F4C104A1, pixels: &[(0, [0, 0, 0, 204]), (43, [0, 0, 0, 170]), (129, [0, 0, 0, 68])] }, // A4
    Reference { format: 12, width: 16, height: 16, seed: 1136, hash: 0xD5C52F2E564A60F6, pixels: &[(0, [255, 255, 183, 255]), (85, [226, 255, 5, 255]), (255, [49, 173, 115, 255])] }, // ETC1
    Reference { format: 12, width: 8, height: 24, seed: 1128, hash: 0xC393E6FFDB07BC62, pixels: &[(0, [77, 0, 36, 255]), (64, [174, 26, 133, 255]), (191, [238, 136, 238, 255])] }, // ETC1
    Reference { format: 12, width: 13, height: 10, seed: 1133, hash: 0x8FE26E5AB9F3B64D, pixels: &[(0, [178, 93, 25, 255]), (43, [59, 25, 93, 255]), (129, [208, 157, 157, 255])] }, // ETC1
    Reference { format: 13, width: 16, height: 16, seed: 1146, hash: 0xE930B395D7553564, pixels: &[(0, [234, 242, 127, 0]), (85, [60, 0, 196, 170]), (255, [75, 255, 117, 68])] }, // ETC1A4
    Reference { format: 13, width: 8, height: 24, seed: 1138, hash: 0xCD8593EBBAD67C4B, pixels: &[(0, [63, 195, 55, 187]), (64, [0, 161, 0, 119]), (191, [118, 0, 85, 17])] }, // ETC1A4
    Reference { format: 13, width: 13, height: 10, seed: 1143, hash: 0x95257FA80160C945, pixels: &[(0, [132, 66, 33, 187]), (43, [94, 52, 11, 221]), (129, [179, 26, 213, 221])] }, // ETC1A4
];
