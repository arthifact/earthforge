//! Small convex material supports in world coordinates. Half-space clipping
//! preserves explicit 3D interfaces; no voxel grid is used as material state.
//! Geometry uses binary64 and is checked by independent analytic volume tests.
use crate::space::WorldPoint as P;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub fn add(a: P, b: P) -> P {
    P {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    }
}
pub fn sub(a: P, b: P) -> P {
    P {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z,
    }
}
pub fn scale(a: P, s: f64) -> P {
    P {
        x: a.x * s,
        y: a.y * s,
        z: a.z * s,
    }
}
pub fn dot(a: P, b: P) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
pub fn cross(a: P, b: P) -> P {
    P {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    }
}
fn finite(p: P) -> bool {
    [p.x, p.y, p.z].iter().all(|x| x.is_finite())
}
fn nonzero(p: P) -> bool {
    p.x != 0.0 || p.y != 0.0 || p.z != 0.0
}
fn order(a: P, b: P) -> Ordering {
    a.x.total_cmp(&b.x)
        .then(a.y.total_cmp(&b.y))
        .then(a.z.total_cmp(&b.z))
}
fn unique(out: &mut Vec<P>, p: P) {
    if !out.contains(&p) {
        out.push(p);
    }
}
fn push_edge(out: &mut Vec<P>, p: P) {
    if out.last() != Some(&p) {
        out.push(p);
    }
}
fn clean_face(mut face: Vec<P>) -> Vec<P> {
    if face.first() == face.last() {
        face.pop();
    }
    face
}
fn compensated(values: impl IntoIterator<Item = f64>) -> f64 {
    let mut sum = 0.0f64;
    let mut correction = 0.0;
    for x in values {
        let next = sum + x;
        correction += if sum.abs() >= x.abs() {
            (sum - next) + x
        } else {
            (x - next) + sum
        };
        sum = next;
    }
    sum + correction
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Aabb {
    pub min: P,
    pub max: P,
}
impl Aabb {
    pub fn validate(self) -> Result<Self, String> {
        let d = sub(self.max, self.min);
        if !finite(self.min)
            || !finite(self.max)
            || !finite(d)
            || d.x <= 0.0
            || d.y <= 0.0
            || d.z <= 0.0
            || !(d.x * d.y * d.z > 0.0 && self.volume().is_finite())
        {
            return Err("Invalid 3D world bounds".into());
        }
        Ok(self)
    }
    pub fn volume(self) -> f64 {
        let d = sub(self.max, self.min);
        d.x * d.y * d.z
    }
    pub fn contains(self, p: P) -> bool {
        p.x >= self.min.x
            && p.x <= self.max.x
            && p.y >= self.min.y
            && p.y <= self.max.y
            && p.z >= self.min.z
            && p.z <= self.max.z
    }
    pub fn planes(self) -> [Plane; 6] {
        [
            Plane {
                point: self.min,
                normal: P {
                    x: -1.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            Plane {
                point: self.max,
                normal: P {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            Plane {
                point: self.min,
                normal: P {
                    x: 0.0,
                    y: -1.0,
                    z: 0.0,
                },
            },
            Plane {
                point: self.max,
                normal: P {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                },
            },
            Plane {
                point: self.min,
                normal: P {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                },
            },
            Plane {
                point: self.max,
                normal: P {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
            },
        ]
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Plane {
    pub point: P,
    pub normal: P,
}
impl Plane {
    pub fn validate(self) -> Result<Self, String> {
        if !finite(self.point) || !finite(self.normal) || !nonzero(self.normal) {
            Err("Invalid clipping plane".into())
        } else {
            Ok(self)
        }
    }
    pub fn distance(self, p: P) -> f64 {
        dot(sub(p, self.point), self.normal)
    }
}
/// Faces wind outward. Construction is restricted to boxes, clipping and
/// translation, so callers cannot inject an open or nonconvex surface.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ConvexPolyhedron {
    faces: Vec<Vec<P>>,
}
impl ConvexPolyhedron {
    pub fn cuboid(bounds: Aabb) -> Result<Self, String> {
        let b = bounds.validate()?;
        let (a, d) = (b.min, b.max);
        let p = [
            P {
                x: a.x,
                y: a.y,
                z: a.z,
            },
            P {
                x: d.x,
                y: a.y,
                z: a.z,
            },
            P {
                x: d.x,
                y: d.y,
                z: a.z,
            },
            P {
                x: a.x,
                y: d.y,
                z: a.z,
            },
            P {
                x: a.x,
                y: a.y,
                z: d.z,
            },
            P {
                x: d.x,
                y: a.y,
                z: d.z,
            },
            P {
                x: d.x,
                y: d.y,
                z: d.z,
            },
            P {
                x: a.x,
                y: d.y,
                z: d.z,
            },
        ];
        Ok(Self {
            faces: [
                [0, 3, 2, 1],
                [4, 5, 6, 7],
                [0, 4, 7, 3],
                [1, 2, 6, 5],
                [0, 1, 5, 4],
                [3, 7, 6, 2],
            ]
            .iter()
            .map(|f| f.iter().map(|i| p[*i]).collect())
            .collect(),
        })
    }
    pub fn faces(&self) -> &[Vec<P>] {
        &self.faces
    }
    pub fn vertices(&self) -> Vec<P> {
        let mut points = vec![];
        for p in self.faces.iter().flatten() {
            unique(&mut points, *p);
        }
        points
    }
    pub fn volume(&self) -> f64 {
        let points = self.vertices();
        if points.is_empty() {
            return 0.0;
        }
        // An interior reference keeps large world-coordinate offsets out of triple
        // products. Positive tetrahedra avoid cancellation between opposite faces.
        let origin = scale(
            points.iter().copied().fold(P::default(), add),
            1.0 / points.len() as f64,
        );
        compensated(self.faces.iter().flat_map(|face| {
            (1..face.len() - 1).map(move |j| {
                dot(
                    sub(face[0], origin),
                    cross(sub(face[j], origin), sub(face[j + 1], origin)),
                ) / 6.0
            })
        }))
    }
    pub fn translated(&self, shift: P) -> Result<Self, String> {
        if !finite(shift) {
            return Err("Invalid material translation".into());
        }
        let faces: Vec<Vec<P>> = self
            .faces
            .iter()
            .map(|face| face.iter().map(|p| add(*p, shift)).collect())
            .collect();
        if faces.iter().flatten().any(|p| !finite(*p)) {
            return Err("3D translation exceeds finite world coordinates".into());
        }
        Ok(Self { faces })
    }
    pub fn contains(&self, point: P) -> bool {
        finite(point)
            && self.faces.iter().all(|face| {
                let normal = (1..face.len() - 1)
                    .map(|j| cross(sub(face[j], face[0]), sub(face[j + 1], face[0])))
                    .find(|n| nonzero(*n));
                normal.is_none_or(|n| dot(n, sub(point, face[0])) <= 0.0)
            })
    }
    /// Keep either closed half-space. Oppositely oriented copies of a shared edge
    /// use the same endpoint order, giving identical intersection coordinates.
    pub fn clip(&self, plane: Plane, negative: bool) -> Result<Option<Self>, String> {
        let plane = plane.validate()?;
        let sign = if negative { 1.0 } else { -1.0 };
        let distance = |p: P| plane.distance(p) * sign;
        let points = self.vertices();
        if points.iter().any(|p| !distance(*p).is_finite()) {
            return Err("Clipping plane exceeds finite coordinate arithmetic".into());
        }
        if points.iter().all(|p| distance(*p) <= 0.0) {
            return Ok(Some(self.clone()));
        }
        if points.iter().all(|p| distance(*p) > 0.0) {
            return Ok(None);
        }
        let mut faces = vec![];
        let mut cap = vec![];
        for face in &self.faces {
            let mut next = vec![];
            for j in 0..face.len() {
                let (a, b) = (face[j], face[(j + 1) % face.len()]);
                let (da, db) = (distance(a), distance(b));
                if da == 0.0 {
                    unique(&mut cap, a);
                }
                if da <= 0.0 {
                    push_edge(&mut next, a);
                }
                if (da < 0.0 && db > 0.0) || (da > 0.0 && db < 0.0) {
                    let (a, b, da, db) = if order(a, b) == Ordering::Greater {
                        (b, a, db, da)
                    } else {
                        (a, b, da, db)
                    };
                    let t = da / (da - db);
                    let p = add(a, scale(sub(b, a), t));
                    if !finite(p) {
                        return Err("Nonfinite polyhedron intersection".into());
                    }
                    push_edge(&mut next, p);
                    unique(&mut cap, p);
                }
            }
            let next = clean_face(next);
            if next.len() >= 3 {
                faces.push(next);
            }
        }
        if cap.len() >= 3 {
            sort_cap(&mut cap, scale(plane.normal, sign));
            faces.push(cap);
        }
        if faces.len() < 4 {
            return Ok(None);
        }
        let next = Self { faces };
        let volume = next.volume();
        if !volume.is_finite() || volume < 0.0 {
            return Err("Invalid clipped material volume".into());
        }
        Ok(if volume == 0.0 { None } else { Some(next) })
    }
    pub fn split(&self, plane: Plane) -> Result<(Option<Self>, Option<Self>), String> {
        Ok((self.clip(plane, true)?, self.clip(plane, false)?))
    }
    /// Intersect with a plane, returning a convex polygon with the plane's winding.
    pub fn section(&self, plane: Plane) -> Result<Vec<P>, String> {
        let plane = plane.validate()?;
        let mut out = vec![];
        for face in &self.faces {
            for j in 0..face.len() {
                let (a, b) = (face[j], face[(j + 1) % face.len()]);
                let (da, db) = (plane.distance(a), plane.distance(b));
                if da == 0.0 {
                    unique(&mut out, a);
                }
                if (da < 0.0 && db > 0.0) || (da > 0.0 && db < 0.0) {
                    let (a, b, da, db) = if order(a, b) == Ordering::Greater {
                        (b, a, db, da)
                    } else {
                        (a, b, da, db)
                    };
                    unique(&mut out, add(a, scale(sub(b, a), da / (da - db))));
                }
            }
        }
        if out.len() >= 3 {
            sort_cap(&mut out, plane.normal);
        } else {
            out.clear();
        }
        Ok(out)
    }
}
fn sort_cap(points: &mut [P], normal: P) {
    let center = scale(
        points.iter().copied().fold(P::default(), add),
        1.0 / points.len() as f64,
    );
    let axis = if normal.x.abs() <= normal.y.abs() && normal.x.abs() <= normal.z.abs() {
        P {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        }
    } else if normal.y.abs() <= normal.z.abs() {
        P {
            x: 0.0,
            y: 1.0,
            z: 0.0,
        }
    } else {
        P {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        }
    };
    let u = cross(axis, normal);
    let v = cross(normal, u);
    points.sort_by(|a, b| {
        let (a, b) = (sub(*a, center), sub(*b, center));
        let (ax, ay, bx, by) = (dot(a, u), dot(a, v), dot(b, u), dot(b, v));
        let half = |x: f64, y: f64| u8::from(!(y > 0.0 || (y == 0.0 && x >= 0.0)));
        half(ax, ay).cmp(&half(bx, by)).then_with(|| {
            let c = ax * by - ay * bx;
            if c > 0.0 {
                Ordering::Less
            } else if c < 0.0 {
                Ordering::Greater
            } else {
                dot(a, a).total_cmp(&dot(b, b))
            }
        })
    });
}
