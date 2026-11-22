// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Règles de format des échanges de schémas Visio (.vsdx) et draw.io (.drawio) (src/net/interop/vsdx.js, drawio.js),
// fusionnées dans NET de src/net/limits.js : { CLE: { v, src } }, chaque src est une clé de src/check/sources.js (bloc
// « @interop » de sources-net.js). Visio : documentation publique de Microsoft ([MS-VSDX] et référence Visio XML de
// learn.microsoft.com) ; draw.io : référence du format publiée par JGraph (drawio.com et dépôt jgraph/drawio-mcp).
export const VISIO_LIM = {
  /** Espace de noms des parties écrites par le client Visio (référence Visio XML) et des relations OPC. */
  VISIO_NS: { v: { main: 'http://schemas.microsoft.com/office/visio/2012/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' }, src: ['msVisioConnectElement', 'msVisioCellElement', 'msVisioShapeElement'] },
  /** Parties du paquet : type de contenu et type de la relation qui y mène ([MS-VSDX] 2.3.3.x). */
  VISIO_PARTS: {
    v: {
      document: { ct: 'application/vnd.ms-visio.drawing.main+xml', rel: 'http://schemas.microsoft.com/visio/2010/relationships/document' },
      pages: { ct: 'application/vnd.ms-visio.pages+xml', rel: 'http://schemas.microsoft.com/visio/2010/relationships/pages' },
      page: { ct: 'application/vnd.ms-visio.page+xml', rel: 'http://schemas.microsoft.com/visio/2010/relationships/page' },
      masters: { ct: 'application/vnd.ms-visio.masters+xml', rel: 'http://schemas.microsoft.com/visio/2010/relationships/masters' },
      master: { ct: 'application/vnd.ms-visio.master+xml', rel: 'http://schemas.microsoft.com/visio/2010/relationships/master' }
    },
    src: ['msVsdxDocumentPart', 'msVsdxPagesPart', 'msVsdxPagePart', 'msVsdxMastersPart', 'msVsdxMasterPart', 'msVisioIntro']
  },
  /** Propriétés du document (docProps) et consigne « RecalcDocument » : Visio recalcule le dessin (connecteurs collés) à l'ouverture. */
  VISIO_DOCPROPS: {
    v: { app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml', custom: 'application/vnd.openxmlformats-officedocument.custom-properties+xml', recalc: 'RecalcDocument', fmtid: '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}' },
    src: ['msVisioManipulate']
  },
  /** Connect : FromPart visBegin 9, visEnd 12 ; ToPart visConnectionPoint = 100 + rang (base 0) du point de connexion, visWholeShape 3. */
  VISIO_CONNECT: { v: { begin: 9, end: 12, point: 100, whole: 3 }, src: ['msVisFromParts', 'msVisToParts', 'msVisioConnectElement'] },
  /** Collage statique d'une extrémité : formule de la cellule = point de l'autre forme ramené au repère de la page (PAR(PNT(…))). */
  VISIO_GLUE: { v: 'PAR(PNT({sheet}!Connections.X{n},{sheet}!Connections.Y{n}))', src: ['msVisioGlueProgram', 'msVisioPar', 'msVisioPnt'] },
  /** Connecteur 1-D « routable » : ObjType = 2 ; largeur d'un 1-D par défaut : SQRT((EndX-BeginX)^2+(EndY-BeginY)^2). */
  VISIO_ONED: { v: { objType: 2, width: 'SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)' }, src: ['msVisioRoutable', 'msVisioCellElement'] },
  /** Données de forme (section Property) : Type 0 chaîne, 2 nombre. */
  VISIO_PROP_TYPES: { v: { string: 0, number: 2 }, src: ['msVisioPropType', 'msVisioShapeDataCells'] },
  /** Calques : cellules d'une ligne de la section Layer ; Color = 255 : le calque n'impose pas de couleur ; LayerMember : rangs (base 0) séparés par « ; ». */
  VISIO_LAYERS: { v: { noColor: 255, cells: ['Name', 'NameUniv', 'Visible', 'Print', 'Active', 'Lock', 'Snap', 'Glue', 'Color'] }, src: ['msVisioLayerCells', 'msVisioLayerColor', 'msVsdxSpec'] },
  /** Unités internes : longueurs en pouces, angles en radians ; couleurs « # » + 6 chiffres hexadécimaux ; échelle métrique (DrawingScaleType 4), taille de page propre (DrawingSizeType 3). */
  VISIO_UNITS: { v: { mmPerInch: 25.4, scaleTypeMetric: 4, sizeTypeCustom: 3 }, src: ['msVsdxSpec', 'msVisioDrawingScale', 'msVisioLineColor'] },
  /** Attributs des éléments Page, Master et Shape lus et écrits (référence Visio XML). */
  VISIO_ELEMENTS: { v: { page: ['ID', 'Name', 'NameU', 'ViewScale', 'ViewCenterX', 'ViewCenterY'], master: ['ID', 'Name', 'NameU', 'UniqueID', 'BaseID', 'IconSize', 'Hidden', 'MatchByName'], shape: ['ID', 'Name', 'NameU', 'Type', 'Master', 'LineStyle', 'FillStyle', 'TextStyle'] }, src: ['msVisioPageElement', 'msVisioMasterElement', 'msVisioShapeElement'] },
  /** draw.io : positions et tailles en px, 850 × 1100 = papier US Letter (donc 100 px par pouce) ; y vers le bas. */
  DRAWIO_PX_PER_IN: { v: 100, src: ['drawioFileFormat'] },
  /** draw.io : cellules 0 (racine) et 1 (calque par défaut, parent 0) obligatoires, calques = cellules de parent 0, données dans <object>. */
  DRAWIO_STRUCT: { v: { root: '0', layer: '1', wrapper: 'object' }, src: ['drawioFileFormat', 'drawioDiagramGeneration', 'drawioMxfileXsd'] },
  /** draw.io : clés de style utilisées (référence des styles). */
  DRAWIO_STYLE_KEYS: { v: ['rounded', 'whiteSpace', 'html', 'fillColor', 'strokeColor', 'fontColor', 'fontSize', 'fontStyle', 'align', 'verticalAlign', 'dashed', 'strokeWidth', 'rotation', 'horizontal', 'ellipse', 'text', 'endArrow', 'startArrow', 'labelBackgroundColor', 'labelPosition', 'verticalLabelPosition', 'exitX', 'exitY', 'entryX', 'entryY'], src: ['drawioStyleReference'] }
};
